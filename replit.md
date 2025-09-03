# Overview

This is a production-ready Microsoft Teams voice agent application that integrates real-time conversational AI capabilities into Teams meetings. The system bridges Teams audio with LiveKit for AI processing, enabling intelligent voice interactions during meetings. It uses Node.js/Express for the main server, with WebSocket connections for real-time audio streaming and Azure Graph API integration for Teams connectivity.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Backend Architecture
The application follows a modular microservices-inspired architecture with distinct components handling different aspects of the voice agent functionality:

- **Express.js Server**: Main HTTP server hosting REST endpoints and serving the demo interface
- **WebSocket Bridge**: Real-time bidirectional communication layer for audio streaming between Teams and LiveKit
- **Teams Media Bot Controller**: Handles Microsoft Teams integration using Azure Graph API for meeting participation and audio access
- **LiveKit Voice Agent**: Manages AI-powered voice processing with OpenAI integration for speech-to-text, language processing, and text-to-speech
- **Audio Processing Engine**: Low-level audio processing including voice activity detection, format conversion, and stream management
- **Meeting Conversation Manager**: Manages meeting state, participant tracking, and conversation flow

## Audio Processing Pipeline
The system implements a real-time audio processing pipeline optimized for Teams meetings:

- **16kHz PCM16 mono audio** for Teams compatibility
- **50ms audio frames** for low-latency processing  
- **Voice Activity Detection** using energy threshold analysis
- **Format conversion** between PCM16 and Float32 for LiveKit compatibility
- **Stream management** with active connection tracking and audio buffering

## Authentication & Authorization
Uses Azure MSAL (Microsoft Authentication Library) with OAuth 2.0 client credentials flow:

- **Azure App Registration** with Graph API permissions for calls and meetings
- **Resource-Specific Consent (RSC)** for meeting-scoped permissions
- **Demo mode fallback** when Azure credentials are not configured

## Real-time Communication
WebSocket-based architecture for low-latency audio streaming:

- **Dedicated WebSocket server** on port 8080 for audio bridge
- **Message-based protocol** for different audio stream types
- **Connection management** with heartbeat and reconnection logic
- **Room-based organization** for multi-meeting support

## AI Integration
Modular AI service integration with fallback support:

- **OpenAI GPT-4** for conversational AI responses
- **OpenAI TTS** for voice synthesis
- **Configurable system prompts** for meeting-appropriate behavior
- **Demo mode** for development without API keys

# External Dependencies

## Microsoft Services
- **Azure Active Directory**: Authentication and app registration
- **Microsoft Graph API**: Teams meeting access and media streaming
- **Microsoft Teams**: Meeting participation and audio capture

## AI Services
- **OpenAI API**: Language model (GPT-4o-mini), text-to-speech (Echo voice)
- **Deepgram** (planned): Speech-to-text processing with Nova-3 model

## Infrastructure Services
- **LiveKit**: Real-time audio/video infrastructure for AI agent hosting
- **Azure Virtual Machine**: Windows Server hosting environment with public IP

## Development Tools
- **Node.js 18+**: Runtime environment with TypeScript support
- **Express.js**: Web framework for REST API endpoints
- **WebSocket (ws)**: Real-time bidirectional communication
- **Winston**: Structured logging and monitoring
- **Jest**: Testing framework for unit and integration tests