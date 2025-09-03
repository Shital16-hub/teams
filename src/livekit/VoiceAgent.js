// LiveKit alternative implementation using WebSocket
const WebSocket = require('ws');
const OpenAI = require('openai');
const winston = require('winston');

class LiveKitVoiceAgent {
  constructor() {
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      defaultMeta: { service: 'livekit-voice-agent' }
    });

    // Initialize AI services (demo mode check)
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'demo_openai_api_key') {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });
      this.demoMode = false;
    } else {
      this.logger.warn('OpenAI API key not configured - running in demo mode');
      this.openai = null;
      this.demoMode = true;
    }

    // LiveKit configuration
    this.liveKitUrl = process.env.LIVEKIT_URL;
    this.liveKitApiKey = process.env.LIVEKIT_API_KEY;
    this.liveKitApiSecret = process.env.LIVEKIT_API_SECRET;

    // Audio configuration
    this.audioConfig = {
      sampleRate: parseInt(process.env.AUDIO_SAMPLE_RATE) || 16000,
      channels: parseInt(process.env.AUDIO_CHANNELS) || 1,
      frameSize: parseInt(process.env.AUDIO_FRAME_SIZE) || 50,
      bytesPerSample: 2
    };

    // Agent state
    this.activeRooms = new Map();
    this.conversationHistories = new Map();
    this.processingQueues = new Map();

    this.systemPrompt = process.env.SYSTEM_PROMPT || 
      "You are a helpful AI assistant in a Microsoft Teams meeting. Keep responses concise, professional, and conversational. Respond to questions and participate naturally in the discussion.";
  }

  async initialize() {
    try {
      // Test AI service connections
      await this.testOpenAIConnection();

      this.logger.info('LiveKit Voice Agent initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize LiveKit Voice Agent:', error);
      throw error;
    }
  }

  async testOpenAIConnection() {
    try {
      if (this.demoMode) {
        this.logger.info('OpenAI demo mode - skipping connection test');
        return;
      }
      
      await this.openai.models.list();
      this.logger.info('OpenAI connection verified');
    } catch (error) {
      this.logger.warn('OpenAI connection test failed, but continuing:', error.message);
    }
  }

  async createRoom(roomName, meetingId) {
    try {
      // Simplified room creation for demo
      const token = `demo_token_${roomName}_${Date.now()}`;

      // Initialize conversation state
      this.conversationHistories.set(roomName, [
        { role: 'system', content: this.systemPrompt }
      ]);

      this.processingQueues.set(roomName, []);

      this.activeRooms.set(roomName, {
        roomName,
        meetingId,
        connectedAt: new Date().toISOString(),
        participants: new Set(),
        isProcessing: false
      });

      this.logger.info('Virtual room created', {
        roomName,
        meetingId,
        identity: 'voice-agent'
      });

      return {
        success: true,
        roomName,
        meetingId,
        token,
        wsUrl: this.liveKitUrl,
        connectedAt: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error('Failed to create room:', error);
      throw new Error(`Room creation failed: ${error.message}`);
    }
  }

  setupRoomEventListeners(room, roomName, meetingId) {
    room.on(RoomEvent.TrackSubscribed, async (track, publication, participant) => {
      this.logger.info('Track subscribed', {
        roomName,
        trackKind: track.kind,
        participantIdentity: participant.identity
      });

      if (track.kind === Track.Kind.Audio) {
        await this.handleAudioTrack(track, participant, roomName);
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      this.logger.info('Track unsubscribed', {
        roomName,
        trackKind: track.kind,
        participantIdentity: participant.identity
      });
    });

    room.on(RoomEvent.ParticipantConnected, (participant) => {
      const roomInfo = this.activeRooms.get(roomName);
      if (roomInfo) {
        roomInfo.participants.add(participant.identity);
        this.activeRooms.set(roomName, roomInfo);
      }

      this.logger.info('Participant connected', {
        roomName,
        participantIdentity: participant.identity
      });
    });

    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      const roomInfo = this.activeRooms.get(roomName);
      if (roomInfo) {
        roomInfo.participants.delete(participant.identity);
        this.activeRooms.set(roomName, roomInfo);
      }

      this.logger.info('Participant disconnected', {
        roomName,
        participantIdentity: participant.identity
      });
    });

    room.on(RoomEvent.Disconnected, () => {
      this.logger.info('Room disconnected', { roomName });
      this.cleanupRoom(roomName);
    });
  }

  async handleAudioTrack(track, participant, roomName) {
    if (!(track instanceof RemoteAudioTrack)) {
      return;
    }

    this.logger.info('Handling audio track', {
      roomName,
      participantIdentity: participant.identity
    });

    // Create audio processing pipeline
    const audioBuffer = [];
    let isProcessing = false;

    track.on(TrackEvent.AudioFrameReceived, async (frame) => {
      try {
        audioBuffer.push(frame);

        // Process audio in chunks to maintain low latency
        if (audioBuffer.length >= 10 && !isProcessing) { // ~500ms of audio at 50ms frames
          isProcessing = true;
          const framesToProcess = audioBuffer.splice(0, 10);
          
          // Process audio asynchronously
          this.processAudioFrames(framesToProcess, participant, roomName)
            .finally(() => {
              isProcessing = false;
            });
        }
      } catch (error) {
        this.logger.error('Error handling audio frame:', error);
      }
    });
  }

  async processAudioFrames(frames, participant, roomName) {
    try {
      const startTime = Date.now();

      // Combine frames into a single buffer
      const combinedBuffer = this.combineAudioFrames(frames);

      // Convert to WAV format for processing
      const wavBuffer = this.pcmToWav(combinedBuffer);

      // Perform speech-to-text
      const transcript = await this.speechToText(wavBuffer);

      if (!transcript || transcript.trim().length === 0) {
        return; // No speech detected
      }

      this.logger.info('Speech detected', {
        roomName,
        participantIdentity: participant.identity,
        transcript: transcript.substring(0, 100) + '...'
      });

      // Generate AI response
      const response = await this.generateAIResponse(transcript, roomName);

      if (response) {
        // Convert response to speech
        const audioResponse = await this.textToSpeech(response);

        // Send audio response back to the room
        await this.sendAudioResponse(audioResponse, roomName);

        const processingTime = Date.now() - startTime;
        this.logger.info('Audio processing complete', {
          roomName,
          processingTime,
          responseLength: response.length
        });
      }

    } catch (error) {
      this.logger.error('Error processing audio frames:', error);
    }
  }

  combineAudioFrames(frames) {
    const totalLength = frames.reduce((sum, frame) => sum + frame.length, 0);
    const combined = new Int16Array(totalLength);
    
    let offset = 0;
    for (const frame of frames) {
      combined.set(new Int16Array(frame), offset);
      offset += frame.length / 2; // 2 bytes per sample
    }
    
    return combined;
  }

  pcmToWav(pcmData) {
    const sampleRate = this.audioConfig.sampleRate;
    const channels = this.audioConfig.channels;
    const bitsPerSample = 16;
    
    const dataLength = pcmData.length * 2;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);
    
    // WAV header
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true);
    view.setUint16(32, channels * (bitsPerSample / 8), true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);
    
    // PCM data
    let offset = 44;
    for (let i = 0; i < pcmData.length; i++) {
      view.setInt16(offset, pcmData[i], true);
      offset += 2;
    }
    
    return Buffer.from(buffer);
  }

  async speechToText(audioBuffer) {
    try {
      // Mock speech-to-text for demo
      this.logger.info('Mock speech-to-text processing audio buffer of size:', audioBuffer.length);
      return 'Hello, this is a demo transcription.';

    } catch (error) {
      this.logger.error('Speech-to-text error:', error);
      return '';
    }
  }

  async generateAIResponse(transcript, roomName) {
    try {
      const conversationHistory = this.conversationHistories.get(roomName) || [
        { role: 'system', content: this.systemPrompt }
      ];

      // Add user message to conversation
      conversationHistory.push({
        role: 'user',
        content: transcript
      });

      let response;
      
      if (this.demoMode) {
        // Generate mock response for demo
        response = `Thank you for saying "${transcript.substring(0, 30)}...". This is a demo response from the AI voice agent. In production, this would be powered by OpenAI's GPT-4o model for natural conversation.`;
      } else {
        // Generate response using OpenAI
        const completion = await this.openai.chat.completions.create({
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          messages: conversationHistory,
          max_tokens: 150,
          temperature: 0.7,
          presence_penalty: 0.1,
          frequency_penalty: 0.1
        });

        response = completion.choices[0]?.message?.content;
      }

      if (response) {
        // Add assistant response to conversation
        conversationHistory.push({
          role: 'assistant',
          content: response
        });

        // Keep conversation history manageable
        if (conversationHistory.length > 20) {
          conversationHistory.splice(1, 2); // Remove oldest user/assistant pair, keep system prompt
        }

        this.conversationHistories.set(roomName, conversationHistory);
      }

      return response;

    } catch (error) {
      this.logger.error('AI response generation error:', error);
      return null;
    }
  }

  async textToSpeech(text) {
    try {
      // Mock text-to-speech for demo
      this.logger.info('Mock text-to-speech generating audio for:', text.substring(0, 50) + '...');
      
      // Return mock audio buffer
      const mockAudioBuffer = Buffer.alloc(16000); // 1 second of silence at 16kHz
      return mockAudioBuffer;

    } catch (error) {
      this.logger.error('Text-to-speech error:', error);
      return null;
    }
  }

  async sendAudioResponse(audioBuffer, roomName) {
    try {
      const roomInfo = this.activeRooms.get(roomName);
      if (!roomInfo || !roomInfo.room) {
        throw new Error('Room not found');
      }

      // Convert audio to PCM format for LiveKit
      const pcmData = this.convertToPCM(audioBuffer);

      // Create audio track and publish
      // Note: This is a simplified implementation
      // In a full implementation, you'd need to create a proper audio track source
      
      this.logger.info('Audio response sent', {
        roomName,
        audioSize: audioBuffer.length
      });

    } catch (error) {
      this.logger.error('Error sending audio response:', error);
    }
  }

  convertToPCM(audioBuffer) {
    // Simplified conversion - in production, you'd need proper audio format conversion
    // This assumes the input is already in a compatible format
    return audioBuffer;
  }

  async joinRoom(roomName, participantIdentity) {
    try {
      const roomInfo = this.activeRooms.get(roomName);
      if (!roomInfo) {
        throw new Error('Room not found');
      }

      // Generate demo token for new participant
      const token = `demo_token_${participantIdentity}_${Date.now()}`;

      return {
        success: true,
        roomName,
        participantIdentity,
        token,
        wsUrl: this.liveKitUrl
      };

    } catch (error) {
      this.logger.error('Failed to join room:', error);
      throw new Error(`Failed to join room: ${error.message}`);
    }
  }

  cleanupRoom(roomName) {
    this.activeRooms.delete(roomName);
    this.conversationHistories.delete(roomName);
    this.processingQueues.delete(roomName);
    
    this.logger.info('Room cleaned up', { roomName });
  }

  async cleanup() {
    this.activeRooms.clear();
    this.conversationHistories.clear();
    this.processingQueues.clear();
    
    this.logger.info('LiveKit Voice Agent cleanup complete');
  }

  getRoomInfo() {
    const rooms = Array.from(this.activeRooms.entries()).map(([roomName, info]) => ({
      roomName,
      meetingId: info.meetingId,
      connectedAt: info.connectedAt,
      participantCount: info.participants.size,
      participants: Array.from(info.participants)
    }));

    return {
      totalActiveRooms: rooms.length,
      rooms,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = LiveKitVoiceAgent;