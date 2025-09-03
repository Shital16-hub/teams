const axios = require('axios');
const { ConfidentialClientApplication } = require('@azure/msal-node');
const winston = require('winston');

class TeamsMediaBotController {
  constructor() {
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      defaultMeta: { service: 'teams-media-bot' }
    });

    // Initialize MSAL client for Azure authentication (demo mode check)
    if (process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET && process.env.AZURE_TENANT_ID) {
      this.msalClient = new ConfidentialClientApplication({
        auth: {
          clientId: process.env.AZURE_CLIENT_ID,
          clientSecret: process.env.AZURE_CLIENT_SECRET,
          authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`
        }
      });
      this.demoMode = false;
    } else {
      this.logger.warn('Azure credentials not configured - running in demo mode');
      this.msalClient = null;
      this.demoMode = true;
    }

    this.activeCalls = new Map();
    this.callbackUrl = process.env.TEAMS_CALLBACK_URL || 'https://your-domain.com/api/teams/callback';
  }

  async getAccessToken() {
    try {
      if (this.demoMode) {
        return 'demo_access_token_' + Date.now();
      }

      const clientCredentialRequest = {
        scopes: ['https://graph.microsoft.com/.default'],
      };

      const response = await this.msalClient.acquireTokenSilent(clientCredentialRequest);
      return response.accessToken;
    } catch (error) {
      this.logger.error('Failed to acquire access token:', error);
      throw new Error('Authentication failed');
    }
  }

  async createMediaConfiguration() {
    return {
      '@odata.type': '#microsoft.graph.appHostedMediaConfig',
      blob: JSON.stringify({
        mediaConfiguration: {
          removeFromDefaultAudioGroup: false,
          supportedModalities: ['audio'],
          audioConfiguration: {
            receiveAudioConfiguration: {
              formats: [{
                '@odata.type': '#microsoft.graph.audioFormat',
                encoding: 'Pcm',
                sampleRate: 16000,
                channels: 1,
                bitsPerSample: 16
              }]
            },
            sendAudioConfiguration: {
              formats: [{
                '@odata.type': '#microsoft.graph.audioFormat', 
                encoding: 'Pcm',
                sampleRate: 16000,
                channels: 1,
                bitsPerSample: 16
              }]
            }
          }
        }
      })
    };
  }

  async joinMeeting(meetingId, customCallbackUrl = null) {
    try {
      const accessToken = await this.getAccessToken();
      
      if (this.demoMode) {
        // Demo mode - simulate successful join
        const callId = `demo_call_${meetingId}_${Date.now()}`;
        this.activeCalls.set(callId, {
          meetingId,
          joinTime: new Date().toISOString(),
          status: 'connected',
          participants: []
        });

        this.logger.info('Demo mode: Simulated Teams meeting join', {
          meetingId,
          callId,
          timestamp: new Date().toISOString()
        });

        return {
          success: true,
          callId,
          meetingId,
          status: 'connected',
          joinTime: new Date().toISOString(),
          demoMode: true
        };
      }

      const mediaConfig = await this.createMediaConfiguration();
      const callbackUri = customCallbackUrl || this.callbackUrl;

      const callRequest = {
        '@odata.type': '#microsoft.graph.call',
        callbackUri: callbackUri,
        requestedModalities: ['audio'],
        mediaConfig: mediaConfig,
        meetingInfo: {
          '@odata.type': '#microsoft.graph.organizerMeetingInfo',
          organizer: {
            '@odata.type': '#microsoft.graph.identitySet',
            user: {
              '@odata.type': '#microsoft.graph.identity',
              id: process.env.TEAMS_APP_ID,
              displayName: 'Voice Agent Bot'
            }
          }
        },
        chatInfo: {
          '@odata.type': '#microsoft.graph.chatInfo',
          threadId: meetingId
        },
        tenantId: process.env.AZURE_TENANT_ID
      };

      const response = await axios.post(
        'https://graph.microsoft.com/v1.0/communications/calls',
        callRequest,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const callId = response.data.id;
      this.activeCalls.set(callId, {
        meetingId,
        joinTime: new Date().toISOString(),
        status: 'connected',
        participants: []
      });

      this.logger.info('Successfully joined Teams meeting', {
        meetingId,
        callId,
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        callId,
        meetingId,
        status: 'connected',
        joinTime: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error('Failed to join Teams meeting:', error);
      throw new Error(`Failed to join meeting: ${error.message}`);
    }
  }

  async leaveMeeting(callId) {
    try {
      const accessToken = await this.getAccessToken();

      await axios.delete(
        `https://graph.microsoft.com/v1.0/communications/calls/${callId}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      );

      const callInfo = this.activeCalls.get(callId);
      this.activeCalls.delete(callId);

      this.logger.info('Successfully left Teams meeting', {
        callId,
        meetingId: callInfo?.meetingId,
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        callId,
        status: 'disconnected',
        leaveTime: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error('Failed to leave Teams meeting:', error);
      throw new Error(`Failed to leave meeting: ${error.message}`);
    }
  }

  async handleCallback(notificationData) {
    try {
      this.logger.info('Received Teams notification:', notificationData);

      const notifications = Array.isArray(notificationData.value) 
        ? notificationData.value 
        : [notificationData];

      const results = [];

      for (const notification of notifications) {
        const result = await this.processNotification(notification);
        results.push(result);
      }

      return {
        success: true,
        processed: results.length,
        results,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error('Error handling Teams callback:', error);
      throw new Error(`Callback processing failed: ${error.message}`);
    }
  }

  async processNotification(notification) {
    const { resourceUrl, changeType, resource } = notification;
    
    this.logger.info('Processing notification', {
      resourceUrl,
      changeType,
      resourceType: resource?.['@odata.type']
    });

    switch (resource?.['@odata.type']) {
      case '#microsoft.graph.call':
        return await this.handleCallNotification(resource, changeType);
      
      case '#microsoft.graph.participant':
        return await this.handleParticipantNotification(resource, changeType);
      
      case '#microsoft.graph.commsOperation':
        return await this.handleOperationNotification(resource, changeType);
      
      default:
        this.logger.warn('Unknown notification type:', resource?.['@odata.type']);
        return {
          type: 'unknown',
          changeType,
          resource: resource?.['@odata.type'],
          status: 'ignored'
        };
    }
  }

  async handleCallNotification(callResource, changeType) {
    const callId = callResource.id;
    const callState = callResource.state;

    this.logger.info('Call notification', {
      callId,
      callState,
      changeType
    });

    switch (changeType) {
      case 'created':
      case 'updated':
        if (this.activeCalls.has(callId)) {
          const callInfo = this.activeCalls.get(callId);
          callInfo.status = callState;
          callInfo.lastUpdate = new Date().toISOString();
          this.activeCalls.set(callId, callInfo);
        }
        break;
      
      case 'deleted':
        this.activeCalls.delete(callId);
        break;
    }

    return {
      type: 'call',
      callId,
      callState,
      changeType,
      status: 'processed'
    };
  }

  async handleParticipantNotification(participantResource, changeType) {
    const participantId = participantResource.id;
    const displayName = participantResource.info?.identity?.user?.displayName;

    this.logger.info('Participant notification', {
      participantId,
      displayName,
      changeType
    });

    // Update participant information in active calls
    for (const [callId, callInfo] of this.activeCalls.entries()) {
      if (changeType === 'created') {
        callInfo.participants.push({
          id: participantId,
          displayName,
          joinTime: new Date().toISOString()
        });
      } else if (changeType === 'deleted') {
        callInfo.participants = callInfo.participants.filter(p => p.id !== participantId);
      }
      this.activeCalls.set(callId, callInfo);
    }

    return {
      type: 'participant',
      participantId,
      displayName,
      changeType,
      status: 'processed'
    };
  }

  async handleOperationNotification(operationResource, changeType) {
    const operationId = operationResource.id;
    const operationType = operationResource.operationType;
    const status = operationResource.status;

    this.logger.info('Operation notification', {
      operationId,
      operationType,
      status,
      changeType
    });

    return {
      type: 'operation',
      operationId,
      operationType,
      status,
      changeType,
      status: 'processed'
    };
  }

  async muteBot(callId) {
    try {
      const accessToken = await this.getAccessToken();

      const muteRequest = {
        clientContext: `mute-${Date.now()}`
      };

      await axios.post(
        `https://graph.microsoft.com/v1.0/communications/calls/${callId}/mute`,
        muteRequest,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      this.logger.info('Bot muted successfully', { callId });
      
      return {
        success: true,
        callId,
        action: 'muted',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error('Failed to mute bot:', error);
      throw new Error(`Failed to mute: ${error.message}`);
    }
  }

  async unmuteBot(callId) {
    try {
      const accessToken = await this.getAccessToken();

      const unmuteRequest = {
        clientContext: `unmute-${Date.now()}`
      };

      await axios.post(
        `https://graph.microsoft.com/v1.0/communications/calls/${callId}/unmute`,
        unmuteRequest,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      this.logger.info('Bot unmuted successfully', { callId });
      
      return {
        success: true,
        callId,
        action: 'unmuted',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error('Failed to unmute bot:', error);
      throw new Error(`Failed to unmute: ${error.message}`);
    }
  }

  getActiveCallsInfo() {
    const calls = Array.from(this.activeCalls.entries()).map(([callId, info]) => ({
      callId,
      ...info
    }));

    return {
      totalActiveCalls: calls.length,
      calls,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = TeamsMediaBotController;