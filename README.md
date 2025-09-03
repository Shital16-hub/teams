# Microsoft Teams Voice Agent - Local Setup Guide

A production-ready Microsoft Teams voice agent application with LiveKit integration for real-time conversational AI. This guide will help you set up and run the application on your local machine.

## 🚀 Quick Start

The application runs in demo mode by default, so you can test it immediately without any API keys. For production features, you'll need to configure the API keys listed in the Configuration section.

### Prerequisites

- **Node.js 18+** (Download from [nodejs.org](https://nodejs.org/))
- **npm** (comes with Node.js)
- **Git** (for cloning the repository)

### Installation Steps

1. **Clone the repository**
   ```bash
   git clone <your-repository-url>
   cd teams-voice-agent
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run the application**
   ```bash
   # Start the backend API server
   npm start
   
   # In a separate terminal, start the demo frontend
   npm run demo
   ```

4. **Access the application**
   - **Demo Interface**: http://localhost:5000
   - **Backend API**: http://localhost:3000
   - **WebSocket Bridge**: ws://localhost:8081

## 📋 Available Scripts

```bash
# Start the backend API server (port 3000)
npm start

# Start the demo frontend interface (port 5000)
npm run demo

# Start both backend and frontend together
npm run dev

# Run tests
npm test

# Run in production mode
npm run production
```

## ⚙️ Configuration

### Environment Variables

Create a `.env` file in the root directory with the following variables:

#### Required for Production (Optional for Demo)

```env
# Microsoft Azure Configuration
AZURE_CLIENT_ID=your_azure_app_client_id
AZURE_CLIENT_SECRET=your_azure_app_client_secret
AZURE_TENANT_ID=your_azure_tenant_id
TEAMS_APP_ID=your_teams_app_id
TEAMS_CALLBACK_URL=https://your-domain.com/api/teams/callback

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini

# LiveKit Configuration (Optional)
LIVEKIT_URL=wss://your-livekit-server.com
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret

# Server Configuration (Optional)
PORT=3000
WS_PORT=8081
NODE_ENV=development
```

#### Optional Configuration

```env
# Audio Processing
AUDIO_SAMPLE_RATE=16000
AUDIO_CHANNELS=1
FRAME_SIZE_MS=50
VOICE_ACTIVITY_THRESHOLD=30

# AI Behavior
SYSTEM_PROMPT="You are a helpful AI assistant in Microsoft Teams meetings."

# Logging
LOG_LEVEL=info
LOG_FORMAT=json
```

### Getting API Keys

#### 1. Microsoft Azure Setup

1. **Create an Azure App Registration**:
   - Go to [Azure Portal](https://portal.azure.com/)
   - Navigate to "Azure Active Directory" > "App registrations"
   - Click "New registration"
   - Name: "Teams Voice Agent"
   - Account types: "Accounts in this organizational directory only"
   - Redirect URI: Leave blank for now

2. **Configure API Permissions**:
   - In your app registration, go to "API permissions"
   - Add the following Microsoft Graph permissions:
     - `Calls.AccessMedia.All` (Application)
     - `Calls.Initiate.All` (Application)
     - `Calls.JoinGroupCall.All` (Application)

3. **Create Client Secret**:
   - Go to "Certificates & secrets"
   - Click "New client secret"
   - Copy the value (this is your `AZURE_CLIENT_SECRET`)

4. **Get IDs**:
   - `AZURE_CLIENT_ID`: Found on the app registration overview page
   - `AZURE_TENANT_ID`: Found on the app registration overview page

#### 2. OpenAI Setup

1. **Create OpenAI Account**:
   - Sign up at [platform.openai.com](https://platform.openai.com/)
   - Add billing information

2. **Generate API Key**:
   - Go to "API Keys" section
   - Click "Create new secret key"
   - Copy the key (this is your `OPENAI_API_KEY`)

#### 3. LiveKit Setup (Optional)

1. **LiveKit Cloud Account**:
   - Sign up at [livekit.io](https://livekit.io/)
   - Create a new project

2. **Get Credentials**:
   - Copy your WebSocket URL (`LIVEKIT_URL`)
   - Generate API key and secret (`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`)

## 🏗️ Architecture Overview

The application consists of several key components:

### Backend Components (Port 3000)
- **Express.js API Server**: Main HTTP server with REST endpoints
- **Teams Media Bot Controller**: Microsoft Graph API integration
- **LiveKit Voice Agent**: AI-powered conversation processing
- **Audio Processing Engine**: Real-time voice activity detection
- **WebSocket Bridge**: Low-latency audio streaming (Port 8081)
- **Meeting Conversation Manager**: Participant tracking and analytics

### Frontend (Port 5000)
- **Interactive Demo Interface**: Web-based testing and monitoring
- **Real-time API Testing**: Live demonstration of all features
- **System Status Dashboard**: Component health monitoring

### Audio Processing Pipeline
- **Input**: 16kHz PCM16 mono audio from Teams
- **Processing**: Voice activity detection, format conversion
- **AI Integration**: Speech-to-text, GPT-4o processing, text-to-speech
- **Output**: Processed audio back to Teams meeting

## 🧪 Testing the Application

### Demo Mode Testing

1. **Start the application** (no API keys required):
   ```bash
   npm start
   npm run demo
   ```

2. **Open the demo interface**: http://localhost:5000

3. **Test API endpoints**:
   - Teams Meeting Integration
   - Audio Processing
   - LiveKit Room Management
   - Meeting Analytics

### Production Testing

1. **Configure environment variables** with real API keys

2. **Test Teams integration**:
   - Create a Teams meeting
   - Use the demo interface to join the meeting
   - Verify audio processing and AI responses

3. **Monitor performance**:
   - Check latency metrics in the demo interface
   - Review logs for any errors
   - Test with multiple concurrent sessions

## 🔧 Troubleshooting

### Common Issues

1. **Port conflicts**:
   ```bash
   # Check if ports are in use
   lsof -i :3000
   lsof -i :5000
   lsof -i :8081
   
   # Kill processes using the ports
   kill -9 <process_id>
   ```

2. **Node.js version issues**:
   ```bash
   # Check Node.js version (requires 18+)
   node --version
   
   # Update Node.js if needed
   # Download from nodejs.org
   ```

3. **Dependency installation failures**:
   ```bash
   # Clear npm cache and reinstall
   npm cache clean --force
   rm -rf node_modules package-lock.json
   npm install
   ```

4. **API connection issues**:
   - Verify API keys are correctly set in `.env`
   - Check network connectivity
   - Review application logs for specific error messages

### Debug Mode

Enable detailed logging:

```bash
# Set debug environment variables
export DEBUG=teams-voice-agent:*
export LOG_LEVEL=debug

# Start with detailed logging
npm start
```

### Log Files

Check application logs:
- Console output shows real-time status
- Error details appear in the terminal
- Demo interface shows API response details

## 📚 API Documentation

### REST Endpoints

- `GET /health` - Application health check
- `POST /api/teams/join-meeting` - Join Teams meeting
- `GET /api/meeting/{id}/status` - Get meeting status
- `POST /api/audio/process` - Process audio data
- `POST /api/livekit/create-room` - Create LiveKit room
- `POST /api/livekit/join-room` - Join LiveKit room
- `POST /api/meeting/initialize` - Initialize meeting tracking

### WebSocket Events

- `audio-data` - Raw audio stream data
- `voice-activity` - Voice activity detection
- `ai-response` - AI-generated responses
- `participant-update` - Meeting participant changes

## 🚀 Deployment

### Local Development
The application is now ready for local development and testing.

### Production Deployment
For production deployment:
1. Configure all required environment variables
2. Set up HTTPS certificates
3. Configure proper CORS settings for your domain
4. Set up process management (PM2, Docker, etc.)
5. Configure load balancing for multiple instances

## 📞 Support

For technical support or questions:
1. Check the troubleshooting section above
2. Review application logs for error details
3. Test in demo mode first to isolate configuration issues
4. Ensure all prerequisites are properly installed

## 🔒 Security Notes

- Never commit API keys to version control
- Use environment variables for all sensitive configuration
- Regularly rotate API keys and secrets
- Implement proper authentication for production deployment
- Monitor application logs for security issues

---

The application is designed to work immediately in demo mode for testing, and can be easily configured for production use with proper API keys. The interactive demo interface provides comprehensive testing of all features and real-time monitoring of system performance.