const winston = require('winston');

class MeetingConversationManager {
  constructor() {
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      defaultMeta: { service: 'meeting-conversation-manager' }
    });

    // Meeting state storage
    this.meetings = new Map();
    this.participantCache = new Map();
    
    // Configuration
    this.config = {
      turnTimeoutMs: parseInt(process.env.TURN_TIMEOUT_MS) || 3000,
      maxParticipants: parseInt(process.env.MAX_PARTICIPANTS) || 50,
      conversationLogLimit: parseInt(process.env.CONVERSATION_LOG_LIMIT) || 1000
    };
  }

  async initialize() {
    this.logger.info('Meeting Conversation Manager initialized', {
      config: this.config
    });
  }

  async initializeMeeting(meetingId, initialParticipants = []) {
    try {
      const meetingState = {
        meetingId,
        startTime: new Date().toISOString(),
        status: 'active',
        participants: new Map(),
        activeSpeaker: null,
        currentTurn: null,
        turnHistory: [],
        conversationLog: [],
        statistics: {
          totalTurns: 0,
          totalSpeakingTime: 0,
          participantStats: new Map()
        }
      };

      // Add initial participants
      for (const participant of initialParticipants) {
        await this.addParticipant(meetingId, participant, false);
      }

      this.meetings.set(meetingId, meetingState);

      this.logger.info('Meeting initialized', {
        meetingId,
        initialParticipantCount: initialParticipants.length
      });

      return {
        success: true,
        meetingId,
        status: 'active',
        startTime: meetingState.startTime,
        participantCount: initialParticipants.length
      };

    } catch (error) {
      this.logger.error('Failed to initialize meeting:', error);
      throw new Error(`Meeting initialization failed: ${error.message}`);
    }
  }

  async addParticipant(meetingId, participantInfo, updateMeeting = true) {
    try {
      if (!this.meetings.has(meetingId)) {
        throw new Error('Meeting not found');
      }

      const meeting = this.meetings.get(meetingId);
      const participantId = participantInfo.id || participantInfo.email || `participant_${Date.now()}`;

      const participant = {
        id: participantId,
        displayName: participantInfo.displayName || participantInfo.name || 'Unknown',
        email: participantInfo.email,
        role: participantInfo.role || 'participant',
        joinTime: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        status: 'active',
        speakingTime: 0,
        turnCount: 0,
        isMuted: false,
        isPresenting: false
      };

      meeting.participants.set(participantId, participant);
      
      // Initialize participant statistics
      meeting.statistics.participantStats.set(participantId, {
        totalSpeakingTime: 0,
        totalTurns: 0,
        averageTurnDuration: 0,
        lastSpeakTime: null
      });

      // Log the event
      this.logConversationEvent(meetingId, {
        type: 'participant_joined',
        participantId,
        data: participant
      });

      if (updateMeeting) {
        this.meetings.set(meetingId, meeting);
      }

      this.logger.info('Participant added to meeting', {
        meetingId,
        participantId,
        displayName: participant.displayName
      });

      return {
        success: true,
        participantId,
        participant,
        totalParticipants: meeting.participants.size
      };

    } catch (error) {
      this.logger.error('Failed to add participant:', error);
      throw new Error(`Failed to add participant: ${error.message}`);
    }
  }

  async removeParticipant(meetingId, participantId) {
    try {
      if (!this.meetings.has(meetingId)) {
        throw new Error('Meeting not found');
      }

      const meeting = this.meetings.get(meetingId);
      const participant = meeting.participants.get(participantId);

      if (!participant) {
        throw new Error('Participant not found');
      }

      // Update participant status
      participant.status = 'left';
      participant.leaveTime = new Date().toISOString();

      // End current turn if this participant is speaking
      if (meeting.activeSpeaker === participantId) {
        await this.endCurrentTurn(meetingId);
      }

      // Log the event
      this.logConversationEvent(meetingId, {
        type: 'participant_left',
        participantId,
        data: participant
      });

      this.meetings.set(meetingId, meeting);

      this.logger.info('Participant removed from meeting', {
        meetingId,
        participantId,
        displayName: participant.displayName
      });

      return {
        success: true,
        participantId,
        participant,
        totalParticipants: Array.from(meeting.participants.values()).filter(p => p.status === 'active').length
      };

    } catch (error) {
      this.logger.error('Failed to remove participant:', error);
      throw new Error(`Failed to remove participant: ${error.message}`);
    }
  }

  async handleVoiceActivity(meetingId, voiceActivityData) {
    try {
      const { participantId, isSpeaking, confidence, audioLevel } = voiceActivityData;

      if (!this.meetings.has(meetingId)) {
        throw new Error('Meeting not found');
      }

      const meeting = this.meetings.get(meetingId);
      const participant = meeting.participants.get(participantId);

      if (!participant) {
        this.logger.warn('Voice activity from unknown participant', {
          meetingId,
          participantId
        });
        return { success: false, error: 'Participant not found' };
      }

      if (isSpeaking && confidence > 0.7) {
        // Start new turn
        await this.startNewTurn(meetingId, participantId, confidence);
      } else if (!isSpeaking && meeting.activeSpeaker === participantId) {
        // End current turn
        await this.endCurrentTurn(meetingId);
      }

      // Update participant last activity
      participant.lastActivity = new Date().toISOString();

      // Log voice activity
      this.logConversationEvent(meetingId, {
        type: 'voice_activity',
        participantId,
        data: {
          isSpeaking,
          confidence,
          audioLevel
        }
      });

      this.meetings.set(meetingId, meeting);

      return {
        success: true,
        meetingId,
        participantId,
        isSpeaking,
        activeSpeaker: meeting.activeSpeaker,
        currentTurn: meeting.currentTurn
      };

    } catch (error) {
      this.logger.error('Failed to handle voice activity:', error);
      throw new Error(`Voice activity handling failed: ${error.message}`);
    }
  }

  async startNewTurn(meetingId, participantId, confidence) {
    const meeting = this.meetings.get(meetingId);
    
    // End previous turn if exists
    if (meeting.currentTurn) {
      await this.endCurrentTurn(meetingId, false);
    }

    const turnStart = new Date().toISOString();

    meeting.activeSpeaker = participantId;
    meeting.currentTurn = {
      participantId,
      startTime: turnStart,
      confidence,
      turnId: `turn_${Date.now()}_${participantId}`
    };

    // Update participant statistics
    const participant = meeting.participants.get(participantId);
    if (participant) {
      participant.turnCount++;
    }

    meeting.statistics.totalTurns++;

    this.logger.debug('New turn started', {
      meetingId,
      participantId,
      turnId: meeting.currentTurn.turnId
    });
  }

  async endCurrentTurn(meetingId, updateMeeting = true) {
    const meeting = this.meetings.get(meetingId);
    
    if (!meeting.currentTurn) {
      return; // No active turn to end
    }

    const turnEnd = new Date().toISOString();
    const currentTurn = meeting.currentTurn;
    const turnDuration = new Date(turnEnd) - new Date(currentTurn.startTime);

    const completedTurn = {
      ...currentTurn,
      endTime: turnEnd,
      duration: turnDuration
    };

    // Add to turn history
    meeting.turnHistory.push(completedTurn);

    // Update participant speaking time
    const participant = meeting.participants.get(currentTurn.participantId);
    if (participant) {
      participant.speakingTime += turnDuration;
    }

    // Update statistics
    const stats = meeting.statistics.participantStats.get(currentTurn.participantId);
    if (stats) {
      stats.totalSpeakingTime += turnDuration;
      stats.totalTurns++;
      stats.averageTurnDuration = stats.totalSpeakingTime / stats.totalTurns;
      stats.lastSpeakTime = turnEnd;
    }

    meeting.statistics.totalSpeakingTime += turnDuration;

    // Clear current turn
    meeting.activeSpeaker = null;
    meeting.currentTurn = null;

    if (updateMeeting) {
      this.meetings.set(meetingId, meeting);
    }

    this.logger.debug('Turn ended', {
      meetingId,
      participantId: currentTurn.participantId,
      turnId: currentTurn.turnId,
      duration: turnDuration
    });

    return completedTurn;
  }

  logConversationEvent(meetingId, event) {
    const meeting = this.meetings.get(meetingId);
    if (!meeting) {
      return;
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      eventId: `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...event
    };

    meeting.conversationLog.push(logEntry);

    // Limit log size
    if (meeting.conversationLog.length > this.config.conversationLogLimit) {
      meeting.conversationLog = meeting.conversationLog.slice(-this.config.conversationLogLimit);
    }
  }

  async getMeetingStatus(meetingId) {
    try {
      if (!this.meetings.has(meetingId)) {
        throw new Error('Meeting not found');
      }

      const meeting = this.meetings.get(meetingId);
      const activeParticipants = Array.from(meeting.participants.values())
        .filter(p => p.status === 'active');

      const currentTime = new Date();
      const startTime = new Date(meeting.startTime);
      const duration = currentTime - startTime;

      return {
        success: true,
        meetingId,
        status: meeting.status,
        startTime: meeting.startTime,
        duration,
        activeSpeaker: meeting.activeSpeaker,
        currentTurn: meeting.currentTurn,
        participants: {
          total: meeting.participants.size,
          active: activeParticipants.length,
          list: activeParticipants.map(p => ({
            id: p.id,
            displayName: p.displayName,
            role: p.role,
            speakingTime: p.speakingTime,
            turnCount: p.turnCount,
            lastActivity: p.lastActivity
          }))
        },
        statistics: {
          totalTurns: meeting.statistics.totalTurns,
          totalSpeakingTime: meeting.statistics.totalSpeakingTime,
          averageTurnDuration: meeting.statistics.totalTurns > 0 
            ? meeting.statistics.totalSpeakingTime / meeting.statistics.totalTurns 
            : 0
        },
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error('Failed to get meeting status:', error);
      throw new Error(`Failed to get meeting status: ${error.message}`);
    }
  }

  async generateMeetingAnalytics(meetingId) {
    try {
      if (!this.meetings.has(meetingId)) {
        throw new Error('Meeting not found');
      }

      const meeting = this.meetings.get(meetingId);
      const participants = Array.from(meeting.participants.values());
      
      // Calculate participation metrics
      const participationMetrics = participants.map(participant => {
        const stats = meeting.statistics.participantStats.get(participant.id);
        const totalMeetingTime = meeting.status === 'ended' 
          ? new Date(meeting.endTime) - new Date(meeting.startTime)
          : new Date() - new Date(meeting.startTime);
        
        return {
          participantId: participant.id,
          displayName: participant.displayName,
          speakingTime: participant.speakingTime,
          speakingPercentage: totalMeetingTime > 0 
            ? (participant.speakingTime / totalMeetingTime) * 100 
            : 0,
          turnCount: participant.turnCount,
          averageTurnDuration: stats ? stats.averageTurnDuration : 0,
          participationScore: this.calculateParticipationScore(participant, totalMeetingTime)
        };
      });

      // Identify conversation patterns
      const conversationPatterns = this.analyzeConversationPatterns(meeting);

      return {
        success: true,
        meetingId,
        generatedAt: new Date().toISOString(),
        summary: {
          totalDuration: meeting.status === 'ended' 
            ? new Date(meeting.endTime) - new Date(meeting.startTime)
            : new Date() - new Date(meeting.startTime),
          totalParticipants: participants.length,
          totalTurns: meeting.statistics.totalTurns,
          totalSpeakingTime: meeting.statistics.totalSpeakingTime
        },
        participationMetrics,
        conversationPatterns,
        recommendations: this.generateRecommendations(participationMetrics, conversationPatterns)
      };

    } catch (error) {
      this.logger.error('Failed to generate meeting analytics:', error);
      throw new Error(`Failed to generate analytics: ${error.message}`);
    }
  }

  calculateParticipationScore(participant, totalMeetingTime) {
    const speakingWeight = 0.4;
    const turnWeight = 0.3;
    const presenceWeight = 0.3;

    const speakingScore = totalMeetingTime > 0 
      ? Math.min(100, (participant.speakingTime / totalMeetingTime) * 100 * 5) // Normalize speaking time
      : 0;
    
    const turnScore = Math.min(100, participant.turnCount * 10); // 10 points per turn, max 100
    
    const presenceScore = participant.status === 'active' ? 100 : 50;

    return Math.round(
      speakingScore * speakingWeight +
      turnScore * turnWeight +
      presenceScore * presenceWeight
    );
  }

  analyzeConversationPatterns(meeting) {
    const patterns = {
      speakingDistribution: this.analyzeSpeakingDistribution(meeting),
      turnTakingPatterns: this.analyzeTurnTaking(meeting),
      participationBalance: this.analyzeParticipationBalance(meeting)
    };

    return patterns;
  }

  analyzeSpeakingDistribution(meeting) {
    const participants = Array.from(meeting.participants.values());
    const totalSpeakingTime = meeting.statistics.totalSpeakingTime;

    if (totalSpeakingTime === 0) {
      return { distribution: 'no-activity', participants: [] };
    }

    const distribution = participants.map(p => ({
      participantId: p.id,
      displayName: p.displayName,
      percentage: (p.speakingTime / totalSpeakingTime) * 100
    })).sort((a, b) => b.percentage - a.percentage);

    // Classify distribution
    const topSpeaker = distribution[0];
    let distributionType;
    
    if (topSpeaker.percentage > 70) {
      distributionType = 'dominated';
    } else if (topSpeaker.percentage > 50) {
      distributionType = 'unbalanced';
    } else {
      distributionType = 'balanced';
    }

    return {
      distribution: distributionType,
      participants: distribution
    };
  }

  analyzeTurnTaking(meeting) {
    const turnHistory = meeting.turnHistory;
    
    if (turnHistory.length < 2) {
      return { pattern: 'insufficient-data' };
    }

    // Analyze turn transitions
    let consecutiveTurns = 0;
    let maxConsecutive = 0;
    let currentSpeaker = null;

    for (const turn of turnHistory) {
      if (turn.participantId === currentSpeaker) {
        consecutiveTurns++;
        maxConsecutive = Math.max(maxConsecutive, consecutiveTurns);
      } else {
        consecutiveTurns = 1;
        currentSpeaker = turn.participantId;
      }
    }

    const avgTurnDuration = turnHistory.reduce((sum, turn) => sum + turn.duration, 0) / turnHistory.length;

    return {
      pattern: maxConsecutive > 3 ? 'monologue-heavy' : 'interactive',
      averageTurnDuration: avgTurnDuration,
      maxConsecutiveTurns: maxConsecutive,
      totalTurns: turnHistory.length
    };
  }

  analyzeParticipationBalance(meeting) {
    const participants = Array.from(meeting.participants.values())
      .filter(p => p.status === 'active');
    
    const activeSpeakers = participants.filter(p => p.turnCount > 0);
    const silentParticipants = participants.filter(p => p.turnCount === 0);

    const participationRate = participants.length > 0 
      ? (activeSpeakers.length / participants.length) * 100 
      : 0;

    let balanceType;
    if (participationRate > 80) {
      balanceType = 'highly-inclusive';
    } else if (participationRate > 60) {
      balanceType = 'moderately-inclusive';
    } else {
      balanceType = 'low-participation';
    }

    return {
      balance: balanceType,
      participationRate,
      activeSpeakers: activeSpeakers.length,
      silentParticipants: silentParticipants.length,
      totalParticipants: participants.length
    };
  }

  generateRecommendations(participationMetrics, conversationPatterns) {
    const recommendations = [];

    // Check speaking distribution
    if (conversationPatterns.speakingDistribution.distribution === 'dominated') {
      recommendations.push({
        type: 'speaking-balance',
        priority: 'high',
        message: 'Consider encouraging more balanced participation. One participant is dominating the conversation.'
      });
    }

    // Check participation balance
    if (conversationPatterns.participationBalance.participationRate < 60) {
      recommendations.push({
        type: 'participation',
        priority: 'medium',
        message: 'Many participants are not speaking. Consider using techniques to encourage broader participation.'
      });
    }

    // Check turn-taking patterns
    if (conversationPatterns.turnTakingPatterns.pattern === 'monologue-heavy') {
      recommendations.push({
        type: 'turn-taking',
        priority: 'medium',
        message: 'Long consecutive speaking turns detected. Consider breaking up content into shorter segments for better engagement.'
      });
    }

    return recommendations;
  }

  async endMeeting(meetingId) {
    try {
      if (!this.meetings.has(meetingId)) {
        throw new Error('Meeting not found');
      }

      const meeting = this.meetings.get(meetingId);
      
      // End any active turn
      if (meeting.currentTurn) {
        await this.endCurrentTurn(meetingId, false);
      }

      meeting.status = 'ended';
      meeting.endTime = new Date().toISOString();

      // Log meeting end
      this.logConversationEvent(meetingId, {
        type: 'meeting_ended',
        data: {
          endTime: meeting.endTime,
          totalDuration: new Date(meeting.endTime) - new Date(meeting.startTime)
        }
      });

      this.meetings.set(meetingId, meeting);

      this.logger.info('Meeting ended', {
        meetingId,
        endTime: meeting.endTime
      });

      return {
        success: true,
        meetingId,
        status: 'ended',
        endTime: meeting.endTime
      };

    } catch (error) {
      this.logger.error('Failed to end meeting:', error);
      throw new Error(`Failed to end meeting: ${error.message}`);
    }
  }

  async cleanup() {
    this.meetings.clear();
    this.participantCache.clear();
    
    this.logger.info('Meeting Conversation Manager cleanup complete');
  }

  getAllMeetings() {
    const meetings = Array.from(this.meetings.values()).map(meeting => ({
      meetingId: meeting.meetingId,
      status: meeting.status,
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      participantCount: meeting.participants.size,
      totalTurns: meeting.statistics.totalTurns
    }));

    return {
      totalMeetings: meetings.length,
      meetings,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = MeetingConversationManager;