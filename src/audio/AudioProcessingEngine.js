const winston = require('winston');

class AudioProcessingEngine {
  constructor() {
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      defaultMeta: { service: 'audio-processing-engine' }
    });

    // Audio configuration
    this.config = {
      sampleRate: parseInt(process.env.AUDIO_SAMPLE_RATE) || 16000,
      channels: parseInt(process.env.AUDIO_CHANNELS) || 1,
      frameSize: parseInt(process.env.AUDIO_FRAME_SIZE) || 50,
      voiceActivityThreshold: parseInt(process.env.VOICE_ACTIVITY_THRESHOLD) || 30,
      maxLatency: parseInt(process.env.MAX_LATENCY_MS) || 250
    };

    // Processing state
    this.activeStreams = new Map();
    this.vadBuffers = new Map();
    this.processingStats = new Map();
  }

  async initialize() {
    this.logger.info('Audio Processing Engine initialized', {
      config: this.config
    });
  }

  async processAudioStream(audioData, options = {}) {
    const startTime = Date.now();
    
    try {
      const {
        format = 'pcm16',
        sampleRate = this.config.sampleRate,
        channels = this.config.channels,
        meetingId = 'default',
        participantId = 'unknown'
      } = options;

      // Decode audio data
      const audioBuffer = this.decodeAudioData(audioData, format);
      
      // Perform voice activity detection
      const vadResult = this.detectVoiceActivity(audioBuffer, meetingId);
      
      // Process audio if voice is detected
      let processedAudio = null;
      if (vadResult.voiceDetected) {
        processedAudio = await this.enhanceAudio(audioBuffer);
      }

      // Calculate processing metrics
      const processingTime = Date.now() - startTime;
      this.updateProcessingStats(meetingId, processingTime);

      const result = {
        voiceDetected: vadResult.voiceDetected,
        confidence: vadResult.confidence,
        audioLength: audioBuffer.length,
        sampleRate,
        channels,
        processingTime,
        withinLatencyTarget: processingTime < this.config.maxLatency,
        processedAudio: processedAudio ? this.encodeAudioData(processedAudio, format) : null,
        timestamp: new Date().toISOString(),
        meetingId,
        participantId
      };

      this.logger.debug('Audio stream processed', {
        meetingId,
        participantId,
        voiceDetected: vadResult.voiceDetected,
        processingTime,
        audioLength: audioBuffer.length
      });

      return result;

    } catch (error) {
      this.logger.error('Audio processing error:', error);
      throw new Error(`Audio processing failed: ${error.message}`);
    }
  }

  decodeAudioData(audioData, format) {
    try {
      let buffer;
      
      if (typeof audioData === 'string') {
        // Base64 encoded data
        buffer = Buffer.from(audioData, 'base64');
      } else if (Buffer.isBuffer(audioData)) {
        buffer = audioData;
      } else {
        throw new Error('Invalid audio data format');
      }

      switch (format.toLowerCase()) {
        case 'pcm16':
          return new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
        
        case 'pcm32':
          return new Int32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
        
        case 'float32':
          return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
        
        default:
          throw new Error(`Unsupported audio format: ${format}`);
      }
    } catch (error) {
      throw new Error(`Failed to decode audio data: ${error.message}`);
    }
  }

  encodeAudioData(audioBuffer, format) {
    try {
      let buffer;
      
      switch (format.toLowerCase()) {
        case 'pcm16':
          buffer = Buffer.from(audioBuffer.buffer);
          break;
        
        case 'pcm32':
          buffer = Buffer.from(audioBuffer.buffer);
          break;
        
        case 'float32':
          buffer = Buffer.from(audioBuffer.buffer);
          break;
        
        default:
          throw new Error(`Unsupported audio format for encoding: ${format}`);
      }

      return buffer.toString('base64');
    } catch (error) {
      throw new Error(`Failed to encode audio data: ${error.message}`);
    }
  }

  detectVoiceActivity(audioBuffer, meetingId) {
    try {
      // Calculate RMS energy
      let sumSquares = 0;
      for (let i = 0; i < audioBuffer.length; i++) {
        const sample = audioBuffer[i] / 32768.0; // Normalize to [-1, 1]
        sumSquares += sample * sample;
      }
      
      const rmsEnergy = Math.sqrt(sumSquares / audioBuffer.length);
      const energyDb = 20 * Math.log10(rmsEnergy + 1e-10); // Convert to dB
      
      // Adaptive threshold based on recent audio history
      const threshold = this.getAdaptiveThreshold(meetingId, energyDb);
      
      // Voice activity detection
      const voiceDetected = energyDb > threshold;
      const confidence = Math.min(1.0, Math.max(0.0, (energyDb - threshold + 20) / 40));

      // Update VAD buffer for adaptive thresholding
      this.updateVADBuffer(meetingId, energyDb, voiceDetected);

      return {
        voiceDetected,
        confidence,
        energyDb,
        threshold,
        rmsEnergy
      };

    } catch (error) {
      this.logger.error('Voice activity detection error:', error);
      return {
        voiceDetected: false,
        confidence: 0,
        energyDb: -60,
        threshold: -40,
        rmsEnergy: 0
      };
    }
  }

  getAdaptiveThreshold(meetingId, currentEnergyDb) {
    const vadBuffer = this.vadBuffers.get(meetingId);
    
    if (!vadBuffer || vadBuffer.length < 10) {
      // Use static threshold if not enough history
      return -40 + (this.config.voiceActivityThreshold - 30) * 2;
    }

    // Calculate noise floor from recent silent periods
    const silentSamples = vadBuffer.filter(sample => !sample.voiceDetected);
    if (silentSamples.length > 0) {
      const avgNoise = silentSamples.reduce((sum, sample) => sum + sample.energyDb, 0) / silentSamples.length;
      return avgNoise + 10; // Threshold 10dB above noise floor
    }

    return -40; // Fallback threshold
  }

  updateVADBuffer(meetingId, energyDb, voiceDetected) {
    if (!this.vadBuffers.has(meetingId)) {
      this.vadBuffers.set(meetingId, []);
    }

    const buffer = this.vadBuffers.get(meetingId);
    buffer.push({
      energyDb,
      voiceDetected,
      timestamp: Date.now()
    });

    // Keep only recent samples (last 5 seconds at 50ms frames)
    if (buffer.length > 100) {
      buffer.splice(0, buffer.length - 100);
    }
  }

  async enhanceAudio(audioBuffer) {
    try {
      // Simple audio enhancement techniques
      const enhanced = new Int16Array(audioBuffer.length);
      
      // Apply noise gate
      const gateThreshold = 0.01;
      
      // Apply gentle compression and normalization
      let maxSample = 0;
      for (let i = 0; i < audioBuffer.length; i++) {
        const sample = audioBuffer[i] / 32768.0; // Normalize to [-1, 1]
        maxSample = Math.max(maxSample, Math.abs(sample));
      }

      const compressionRatio = maxSample > 0.7 ? 0.7 / maxSample : 1.0;
      
      for (let i = 0; i < audioBuffer.length; i++) {
        let sample = audioBuffer[i] / 32768.0; // Normalize to [-1, 1]
        
        // Apply noise gate
        if (Math.abs(sample) < gateThreshold) {
          sample = 0;
        }
        
        // Apply compression
        sample *= compressionRatio;
        
        // Apply gentle high-pass filter for voice clarity
        if (i > 0) {
          const alpha = 0.99; // High-pass filter coefficient
          sample = alpha * (sample + enhanced[i-1]/32768.0 - audioBuffer[i-1]/32768.0);
        }
        
        // Convert back to 16-bit
        enhanced[i] = Math.max(-32768, Math.min(32767, sample * 32768));
      }

      return enhanced;

    } catch (error) {
      this.logger.error('Audio enhancement error:', error);
      return audioBuffer; // Return original if enhancement fails
    }
  }

  updateProcessingStats(meetingId, processingTime) {
    if (!this.processingStats.has(meetingId)) {
      this.processingStats.set(meetingId, {
        totalProcessed: 0,
        totalTime: 0,
        minTime: Infinity,
        maxTime: 0,
        recentTimes: []
      });
    }

    const stats = this.processingStats.get(meetingId);
    stats.totalProcessed++;
    stats.totalTime += processingTime;
    stats.minTime = Math.min(stats.minTime, processingTime);
    stats.maxTime = Math.max(stats.maxTime, processingTime);
    
    stats.recentTimes.push(processingTime);
    if (stats.recentTimes.length > 100) {
      stats.recentTimes.shift();
    }

    this.processingStats.set(meetingId, stats);
  }

  getProcessingStats(meetingId) {
    const stats = this.processingStats.get(meetingId);
    
    if (!stats) {
      return {
        meetingId,
        totalProcessed: 0,
        averageTime: 0,
        minTime: 0,
        maxTime: 0,
        recentAverageTime: 0,
        withinTargetPercentage: 0
      };
    }

    const averageTime = stats.totalTime / stats.totalProcessed;
    const recentAverageTime = stats.recentTimes.length > 0 
      ? stats.recentTimes.reduce((sum, time) => sum + time, 0) / stats.recentTimes.length 
      : 0;
    
    const withinTargetCount = stats.recentTimes.filter(time => time < this.config.maxLatency).length;
    const withinTargetPercentage = stats.recentTimes.length > 0 
      ? (withinTargetCount / stats.recentTimes.length) * 100 
      : 0;

    return {
      meetingId,
      totalProcessed: stats.totalProcessed,
      averageTime,
      minTime: stats.minTime === Infinity ? 0 : stats.minTime,
      maxTime: stats.maxTime,
      recentAverageTime,
      withinTargetPercentage,
      targetLatency: this.config.maxLatency
    };
  }

  getAllProcessingStats() {
    const allStats = [];
    for (const meetingId of this.processingStats.keys()) {
      allStats.push(this.getProcessingStats(meetingId));
    }
    
    return {
      meetings: allStats,
      totalMeetings: allStats.length,
      timestamp: new Date().toISOString()
    };
  }

  convertPCM16ToFloat32(pcm16Buffer) {
    const float32Buffer = new Float32Array(pcm16Buffer.length);
    for (let i = 0; i < pcm16Buffer.length; i++) {
      float32Buffer[i] = pcm16Buffer[i] / 32768.0;
    }
    return float32Buffer;
  }

  convertFloat32ToPCM16(float32Buffer) {
    const pcm16Buffer = new Int16Array(float32Buffer.length);
    for (let i = 0; i < float32Buffer.length; i++) {
      const sample = Math.max(-1, Math.min(1, float32Buffer[i]));
      pcm16Buffer[i] = sample * 32767;
    }
    return pcm16Buffer;
  }

  async cleanup() {
    this.activeStreams.clear();
    this.vadBuffers.clear();
    this.processingStats.clear();
    
    this.logger.info('Audio Processing Engine cleanup complete');
  }
}

module.exports = AudioProcessingEngine;