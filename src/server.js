const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const WebSocket = require('ws');
const dotenv = require('dotenv');
const winston = require('winston');
const path = require('path');

// Import application modules
const TeamsMediaBotController = require('./teams/MediaBotController');
const LiveKitVoiceAgent = require('./livekit/VoiceAgent');
const TeamsLiveKitBridge = require('./websocket/TeamsLiveKitBridge');
const AudioProcessingEngine = require('./audio/AudioProcessingEngine');
const MeetingConversationManager = require('./teams/MeetingConversationManager');

// Load environment variables
dotenv.config();

// Configure logging
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'teams-voice-agent' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

class TeamsVoiceAgentServer {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    this.wsPort = process.env.WS_PORT || 8081;
    this.logger = logger;
    
    // Initialize components
    this.teamsController = new TeamsMediaBotController();
    this.liveKitAgent = new LiveKitVoiceAgent();
    this.audioEngine = new AudioProcessingEngine();
    this.meetingManager = new MeetingConversationManager();
    this.bridge = null;
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocketServer();
  }

  setupMiddleware() {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "wss:", "https:"],
        },
      },
    }));

    // CORS configuration for Teams integration
    this.app.use(cors({
      origin: [
        'https://teams.microsoft.com',
        'https://*.teams.microsoft.com',
        'https://graph.microsoft.com',
        process.env.TEAMS_CALLBACK_URL || 'http://localhost:5000'
      ],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    }));

    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request logging
    this.app.use((req, res, next) => {
      this.logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString()
      });
      next();
    });
  }

  setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development'
      });
    });

    // Teams Media Bot endpoints
    this.app.post('/api/teams/callback', async (req, res) => {
      try {
        const result = await this.teamsController.handleCallback(req.body);
        res.json(result);
      } catch (error) {
        this.logger.error('Teams callback error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    this.app.post('/api/teams/join-meeting', async (req, res) => {
      try {
        const { meetingId, callbackUrl } = req.body;
        const result = await this.teamsController.joinMeeting(meetingId, callbackUrl);
        res.json(result);
      } catch (error) {
        this.logger.error('Join meeting error:', error);
        res.status(500).json({ error: 'Failed to join meeting' });
      }
    });

    this.app.post('/api/teams/leave-meeting', async (req, res) => {
      try {
        const { callId } = req.body;
        const result = await this.teamsController.leaveMeeting(callId);
        res.json(result);
      } catch (error) {
        this.logger.error('Leave meeting error:', error);
        res.status(500).json({ error: 'Failed to leave meeting' });
      }
    });

    // Audio processing endpoints
    this.app.post('/api/audio/process', async (req, res) => {
      try {
        const startTime = Date.now();
        const { audioData, format, meetingId } = req.body;
        
        const result = await this.audioEngine.processAudioStream(audioData, {
          format: format || 'pcm16',
          sampleRate: 16000,
          channels: 1,
          meetingId
        });

        const processingTime = Date.now() - startTime;
        
        res.json({
          ...result,
          performance: {
            processingTime,
            targetLatency: parseInt(process.env.MAX_LATENCY_MS) || 250,
            withinTarget: processingTime < (parseInt(process.env.MAX_LATENCY_MS) || 250)
          }
        });
      } catch (error) {
        this.logger.error('Audio processing error:', error);
        res.status(500).json({ error: 'Audio processing failed' });
      }
    });

    // LiveKit integration endpoints
    this.app.post('/api/livekit/create-room', async (req, res) => {
      try {
        const { roomName, meetingId } = req.body;
        const result = await this.liveKitAgent.createRoom(roomName, meetingId);
        res.json(result);
      } catch (error) {
        this.logger.error('LiveKit room creation error:', error);
        res.status(500).json({ error: 'Failed to create LiveKit room' });
      }
    });

    this.app.post('/api/livekit/join-room', async (req, res) => {
      try {
        const { roomName, participantIdentity } = req.body;
        const result = await this.liveKitAgent.joinRoom(roomName, participantIdentity);
        res.json(result);
      } catch (error) {
        this.logger.error('LiveKit join room error:', error);
        res.status(500).json({ error: 'Failed to join LiveKit room' });
      }
    });

    // Meeting management endpoints
    this.app.post('/api/meeting/initialize', async (req, res) => {
      try {
        const { meetingId, participants } = req.body;
        const result = await this.meetingManager.initializeMeeting(meetingId, participants);
        res.json(result);
      } catch (error) {
        this.logger.error('Meeting initialization error:', error);
        res.status(500).json({ error: 'Failed to initialize meeting' });
      }
    });

    this.app.get('/api/meeting/:meetingId/status', async (req, res) => {
      try {
        const { meetingId } = req.params;
        const result = await this.meetingManager.getMeetingStatus(meetingId);
        res.json(result);
      } catch (error) {
        this.logger.error('Meeting status error:', error);
        res.status(500).json({ error: 'Failed to get meeting status' });
      }
    });

    // Error handling middleware
    this.app.use((error, req, res, next) => {
      this.logger.error('Unhandled error:', error);
      res.status(500).json({
        error: 'Internal server error',
        timestamp: new Date().toISOString()
      });
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Endpoint not found',
        path: req.originalUrl,
        timestamp: new Date().toISOString()
      });
    });
  }

  setupWebSocketServer() {
    this.wss = new WebSocket.Server({
      port: this.wsPort,
      perMessageDeflate: false,
      maxPayload: 10 * 1024 * 1024 // 10MB max payload
    });

    this.bridge = new TeamsLiveKitBridge(this.wss, {
      logger: this.logger,
      audioEngine: this.audioEngine,
      liveKitAgent: this.liveKitAgent
    });

    this.wss.on('connection', (ws, req) => {
      this.logger.info('WebSocket connection established', {
        ip: req.socket.remoteAddress,
        userAgent: req.headers['user-agent']
      });

      // Set up heartbeat
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      // Handle messages through the bridge
      ws.on('message', async (data) => {
        try {
          await this.bridge.handleMessage(ws, data);
        } catch (error) {
          this.logger.error('WebSocket message handling error:', error);
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Message processing failed',
            timestamp: new Date().toISOString()
          }));
        }
      });

      ws.on('close', (code, reason) => {
        this.logger.info('WebSocket connection closed', { code, reason: reason.toString() });
        this.bridge.handleDisconnection(ws);
      });

      ws.on('error', (error) => {
        this.logger.error('WebSocket error:', error);
      });
    });

    // WebSocket heartbeat
    const heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (!ws.isAlive) {
          ws.terminate();
          return;
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, parseInt(process.env.WS_HEARTBEAT_INTERVAL) || 30000);

    this.wss.on('close', () => {
      clearInterval(heartbeatInterval);
    });
  }

  async start() {
    try {
      // Initialize components
      await this.liveKitAgent.initialize();
      await this.audioEngine.initialize();
      await this.meetingManager.initialize();

      // Start HTTP server
      this.server = this.app.listen(this.port, '0.0.0.0', () => {
        this.logger.info(`Teams Voice Agent Server started`, {
          httpPort: this.port,
          wsPort: this.wsPort,
          environment: process.env.NODE_ENV || 'development',
          timestamp: new Date().toISOString()
        });
      });

      // Graceful shutdown handling
      process.on('SIGTERM', () => this.shutdown());
      process.on('SIGINT', () => this.shutdown());

      this.logger.info('Application initialization complete');
      
    } catch (error) {
      this.logger.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  async shutdown() {
    this.logger.info('Shutting down gracefully...');
    
    try {
      // Close WebSocket server
      if (this.wss) {
        this.wss.close();
      }

      // Close HTTP server
      if (this.server) {
        this.server.close();
      }

      // Cleanup components
      if (this.bridge) {
        await this.bridge.cleanup();
      }
      
      if (this.liveKitAgent) {
        await this.liveKitAgent.cleanup();
      }
      
      if (this.audioEngine) {
        await this.audioEngine.cleanup();
      }

      this.logger.info('Shutdown complete');
      process.exit(0);
    } catch (error) {
      this.logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  }
}

// Start the server
if (require.main === module) {
  const server = new TeamsVoiceAgentServer();
  server.start();
}

module.exports = TeamsVoiceAgentServer;