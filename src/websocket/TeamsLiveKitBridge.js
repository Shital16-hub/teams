const WebSocket = require('ws');
const winston = require('winston');

class TeamsLiveKitBridge {
  constructor(wss, options = {}) {
    this.wss = wss;
    this.logger = options.logger || winston.createLogger({
      level: 'info',
      format: winston.format.simple()
    });
    
    this.audioEngine = options.audioEngine;
    this.liveKitAgent = options.liveKitAgent;

    // Connection management
    this.connections = new Map();
    this.rooms = new Map();
    
    // Configuration
    this.config = {
      heartbeatInterval: parseInt(process.env.WS_HEARTBEAT_INTERVAL) || 30000,
      maxReconnectAttempts: parseInt(process.env.WS_MAX_RECONNECT_ATTEMPTS) || 5,
      reconnectDelay: parseInt(process.env.WS_RECONNECT_DELAY) || 1000,
      audioFormat: {
        sampleRate: 16000,
        channels: 1,
        frameSize: 50,
        encoding: 'pcm16'
      }
    };

    this.messageHandlers = {
      'teams-audio': this.handleTeamsAudio.bind(this),
      'livekit-audio': this.handleLiveKitAudio.bind(this),
      'join-room': this.handleJoinRoom.bind(this),
      'leave-room': this.handleLeaveRoom.bind(this),
      'heartbeat': this.handleHeartbeat.bind(this),
      'get-status': this.handleGetStatus.bind(this)
    };
  }

  async handleMessage(ws, data) {
    try {
      const message = JSON.parse(data.toString());
      const { type, id, payload } = message;

      this.logger.debug('WebSocket message received', {
        type,
        id,
        connectionId: this.getConnectionId(ws)
      });

      const handler = this.messageHandlers[type];
      if (handler) {
        const result = await handler(ws, payload, id);
        
        // Send response back to client
        this.sendMessage(ws, {
          type: `${type}-response`,
          id,
          payload: result,
          timestamp: new Date().toISOString()
        });
      } else {
        this.sendMessage(ws, {
          type: 'error',
          id,
          payload: {
            error: `Unknown message type: ${type}`,
            supportedTypes: Object.keys(this.messageHandlers)
          },
          timestamp: new Date().toISOString()
        });
      }

    } catch (error) {
      this.logger.error('Message handling error:', error);
      this.sendMessage(ws, {
        type: 'error',
        payload: {
          error: 'Message processing failed',
          details: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }

  async handleTeamsAudio(ws, payload, messageId) {
    try {
      const { audioData, meetingId, participantId, format } = payload;
      const startTime = Date.now();

      if (!audioData || !meetingId) {
        throw new Error('Missing required fields: audioData, meetingId');
      }

      // Process audio through the audio engine
      const processedResult = await this.audioEngine.processAudioStream(audioData, {
        format: format || this.config.audioFormat.encoding,
        sampleRate: this.config.audioFormat.sampleRate,
        channels: this.config.audioFormat.channels,
        meetingId,
        participantId
      });

      // If voice is detected, forward to LiveKit
      if (processedResult.voiceDetected && processedResult.processedAudio) {
        await this.forwardAudioToLiveKit(processedResult, meetingId);
      }

      const processingTime = Date.now() - startTime;

      return {
        success: true,
        voiceDetected: processedResult.voiceDetected,
        confidence: processedResult.confidence,
        processingTime,
        meetingId,
        participantId,
        forwardedToLiveKit: processedResult.voiceDetected
      };

    } catch (error) {
      this.logger.error('Teams audio handling error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async handleLiveKitAudio(ws, payload, messageId) {
    try {
      const { audioData, roomName, participantId, format } = payload;

      if (!audioData || !roomName) {
        throw new Error('Missing required fields: audioData, roomName');
      }

      // Forward audio response back to Teams
      await this.forwardAudioToTeams(audioData, roomName, participantId);

      return {
        success: true,
        roomName,
        participantId,
        forwardedToTeams: true
      };

    } catch (error) {
      this.logger.error('LiveKit audio handling error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async handleJoinRoom(ws, payload, messageId) {
    try {
      const { roomName, meetingId, participantIdentity } = payload;

      if (!roomName) {
        throw new Error('Missing required field: roomName');
      }

      // Store connection information
      const connectionId = this.getConnectionId(ws);
      this.connections.set(connectionId, {
        ws,
        roomName,
        meetingId,
        participantIdentity,
        joinedAt: new Date().toISOString()
      });

      // Add to room tracking
      if (!this.rooms.has(roomName)) {
        this.rooms.set(roomName, new Set());
      }
      this.rooms.get(roomName).add(connectionId);

      // Create or join LiveKit room
      let roomResult;
      if (meetingId) {
        roomResult = await this.liveKitAgent.createRoom(roomName, meetingId);
      } else {
        roomResult = await this.liveKitAgent.joinRoom(roomName, participantIdentity || 'unknown');
      }

      this.logger.info('WebSocket client joined room', {
        connectionId,
        roomName,
        meetingId,
        participantIdentity
      });

      return {
        success: true,
        roomName,
        meetingId,
        participantIdentity,
        liveKitInfo: roomResult
      };

    } catch (error) {
      this.logger.error('Join room error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async handleLeaveRoom(ws, payload, messageId) {
    try {
      const connectionId = this.getConnectionId(ws);
      const connection = this.connections.get(connectionId);

      if (!connection) {
        throw new Error('Connection not found');
      }

      const { roomName } = connection;

      // Remove from room tracking
      if (this.rooms.has(roomName)) {
        this.rooms.get(roomName).delete(connectionId);
        if (this.rooms.get(roomName).size === 0) {
          this.rooms.delete(roomName);
        }
      }

      // Remove connection
      this.connections.delete(connectionId);

      this.logger.info('WebSocket client left room', {
        connectionId,
        roomName
      });

      return {
        success: true,
        roomName,
        leftAt: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error('Leave room error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async handleHeartbeat(ws, payload, messageId) {
    return {
      success: true,
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    };
  }

  async handleGetStatus(ws, payload, messageId) {
    const connectionId = this.getConnectionId(ws);
    const connection = this.connections.get(connectionId);

    const status = {
      connectionId,
      connected: true,
      roomName: connection?.roomName,
      meetingId: connection?.meetingId,
      participantIdentity: connection?.participantIdentity,
      joinedAt: connection?.joinedAt,
      totalConnections: this.connections.size,
      totalRooms: this.rooms.size,
      audioConfig: this.config.audioFormat,
      timestamp: new Date().toISOString()
    };

    return {
      success: true,
      status
    };
  }

  async forwardAudioToLiveKit(processedResult, meetingId) {
    try {
      // Find connections in the same meeting/room
      const roomConnections = this.findConnectionsByMeeting(meetingId);

      if (roomConnections.length === 0) {
        this.logger.warn('No LiveKit connections found for meeting', { meetingId });
        return;
      }

      const audioMessage = {
        type: 'teams-audio-forward',
        payload: {
          audioData: processedResult.processedAudio,
          meetingId,
          voiceDetected: processedResult.voiceDetected,
          confidence: processedResult.confidence,
          format: this.config.audioFormat.encoding,
          timestamp: new Date().toISOString()
        }
      };

      // Send to all connections in the room
      roomConnections.forEach(connection => {
        if (connection.ws.readyState === WebSocket.OPEN) {
          this.sendMessage(connection.ws, audioMessage);
        }
      });

      this.logger.debug('Audio forwarded to LiveKit', {
        meetingId,
        connectionCount: roomConnections.length
      });

    } catch (error) {
      this.logger.error('Error forwarding audio to LiveKit:', error);
    }
  }

  async forwardAudioToTeams(audioData, roomName, participantId) {
    try {
      const roomConnections = this.findConnectionsByRoom(roomName);

      if (roomConnections.length === 0) {
        this.logger.warn('No Teams connections found for room', { roomName });
        return;
      }

      const audioMessage = {
        type: 'livekit-audio-forward',
        payload: {
          audioData,
          roomName,
          participantId,
          format: this.config.audioFormat.encoding,
          timestamp: new Date().toISOString()
        }
      };

      // Send to all connections in the room
      roomConnections.forEach(connection => {
        if (connection.ws.readyState === WebSocket.OPEN) {
          this.sendMessage(connection.ws, audioMessage);
        }
      });

      this.logger.debug('Audio forwarded to Teams', {
        roomName,
        participantId,
        connectionCount: roomConnections.length
      });

    } catch (error) {
      this.logger.error('Error forwarding audio to Teams:', error);
    }
  }

  findConnectionsByMeeting(meetingId) {
    const connections = [];
    for (const connection of this.connections.values()) {
      if (connection.meetingId === meetingId) {
        connections.push(connection);
      }
    }
    return connections;
  }

  findConnectionsByRoom(roomName) {
    const connections = [];
    for (const connection of this.connections.values()) {
      if (connection.roomName === roomName) {
        connections.push(connection);
      }
    }
    return connections;
  }

  sendMessage(ws, message) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    } catch (error) {
      this.logger.error('Error sending WebSocket message:', error);
    }
  }

  getConnectionId(ws) {
    // Generate a unique ID for the connection if it doesn't have one
    if (!ws.connectionId) {
      ws.connectionId = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    return ws.connectionId;
  }

  handleDisconnection(ws) {
    try {
      const connectionId = this.getConnectionId(ws);
      const connection = this.connections.get(connectionId);

      if (connection) {
        const { roomName } = connection;

        // Remove from room tracking
        if (this.rooms.has(roomName)) {
          this.rooms.get(roomName).delete(connectionId);
          if (this.rooms.get(roomName).size === 0) {
            this.rooms.delete(roomName);
          }
        }

        // Remove connection
        this.connections.delete(connectionId);

        this.logger.info('WebSocket connection disconnected', {
          connectionId,
          roomName
        });
      }
    } catch (error) {
      this.logger.error('Error handling disconnection:', error);
    }
  }

  broadcastToRoom(roomName, message) {
    const roomConnections = this.findConnectionsByRoom(roomName);
    roomConnections.forEach(connection => {
      this.sendMessage(connection.ws, message);
    });
  }

  broadcastToMeeting(meetingId, message) {
    const meetingConnections = this.findConnectionsByMeeting(meetingId);
    meetingConnections.forEach(connection => {
      this.sendMessage(connection.ws, message);
    });
  }

  getConnectionStats() {
    const rooms = Array.from(this.rooms.entries()).map(([roomName, connections]) => ({
      roomName,
      connectionCount: connections.size,
      connections: Array.from(connections)
    }));

    return {
      totalConnections: this.connections.size,
      totalRooms: this.rooms.size,
      rooms,
      timestamp: new Date().toISOString()
    };
  }

  async cleanup() {
    // Close all connections
    for (const connection of this.connections.values()) {
      try {
        if (connection.ws.readyState === WebSocket.OPEN) {
          connection.ws.close();
        }
      } catch (error) {
        this.logger.error('Error closing WebSocket connection:', error);
      }
    }

    this.connections.clear();
    this.rooms.clear();

    this.logger.info('TeamsLiveKitBridge cleanup complete');
  }
}

module.exports = TeamsLiveKitBridge;