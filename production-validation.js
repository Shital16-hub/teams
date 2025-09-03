// production-validation.js
require('dotenv').config();
const axios = require('axios');

async function validateProductionSetup() {
    console.log('🚀 Validating Production Setup...\n');
    
    const BASE_URL = 'http://localhost:5000'; // Your app is running on port 5000
    const PUBLIC_URL = 'https://public-houses-look.loca.lt';

    // Test 1: Local server health
    console.log('1. Testing local server...');
    try {
        const health = await axios.get(`${BASE_URL}/health`);
        console.log('✅ Local server is healthy');
        console.log(`   Status: ${health.data.status}`);
        console.log(`   Environment: ${health.data.environment}`);
        console.log(`   Port: 5000`);
    } catch (error) {
        console.log('❌ Local server issue:', error.message);
        return;
    }

    // Test 2: Public URL accessibility
    console.log('\n2. Testing public URL...');
    try {
        const publicHealth = await axios.get(`${PUBLIC_URL}/health`, { timeout: 10000 });
        console.log('✅ Public URL is accessible');
        console.log(`   Public URL: ${PUBLIC_URL}`);
        console.log(`   Status: ${publicHealth.data.status}`);
    } catch (error) {
        console.log('❌ Public URL not accessible:', error.message);
        console.log('   Make sure localtunnel is running: lt --port 5000');
    }

    // Test 3: Production API endpoints
    console.log('\n3. Testing production APIs...');
    
    const testCases = [
        {
            name: 'Teams Meeting Join',
            endpoint: '/api/teams/join-meeting',
            method: 'POST',
            data: {
                meetingId: 'prod-validation-001',
                callbackUrl: `${PUBLIC_URL}/api/teams/callback`
            }
        },
        {
            name: 'Audio Processing with Real AI',
            endpoint: '/api/audio/process', 
            method: 'POST',
            data: {
                audioData: Buffer.from('test audio for production').toString('base64'),
                format: 'pcm16',
                meetingId: 'prod-validation-001',
                participantId: 'test-participant'
            }
        },
        {
            name: 'LiveKit Room Creation',
            endpoint: '/api/livekit/create-room',
            method: 'POST', 
            data: {
                roomName: 'prod-validation-room',
                meetingId: 'prod-validation-001'
            }
        },
        {
            name: 'Meeting Analytics',
            endpoint: '/api/meeting/initialize',
            method: 'POST',
            data: {
                meetingId: 'prod-validation-001',
                participants: [
                    {
                        id: 'prod-test-user',
                        displayName: 'Production Test User',
                        email: 'prodtest@example.com'
                    }
                ]
            }
        }
    ];

    for (const test of testCases) {
        try {
            console.log(`   Testing ${test.name}...`);
            const response = await axios({
                method: test.method,
                url: `${BASE_URL}${test.endpoint}`,
                data: test.data,
                timeout: 15000
            });

            if (response.data.success) {
                console.log(`   ✅ ${test.name} - Success`);
                
                // Check if we're still in demo mode
                if (response.data.demoMode) {
                    console.log(`   ⚠️  Still in demo mode for ${test.name}`);
                } else {
                    console.log(`   🎉 Using real production services!`);
                }

                // Show key response data
                if (response.data.callId) {
                    console.log(`      Call ID: ${response.data.callId}`);
                }
                if (response.data.processingTime) {
                    console.log(`      Processing time: ${response.data.processingTime}ms`);
                }
                if (response.data.voiceDetected !== undefined) {
                    console.log(`      Voice detected: ${response.data.voiceDetected}`);
                }
            } else {
                console.log(`   ⚠️  ${test.name} - Response: ${JSON.stringify(response.data)}`);
            }
        } catch (error) {
            console.log(`   ❌ ${test.name} - Failed`);
            if (error.response) {
                console.log(`      Status: ${error.response.status}`);
                console.log(`      Error: ${error.response.data?.error || 'Unknown'}`);
            } else {
                console.log(`      Error: ${error.message}`);
            }
        }
    }

    // Test 4: WebSocket connectivity  
    console.log('\n4. WebSocket server validation...');
    console.log(`   WebSocket running on: ws://localhost:8080`);
    console.log(`   Public WebSocket: wss://public-houses-look.loca.lt`);
    console.log('   Use the WebSocket test client to verify connectivity');

    // Test 5: Service integrations check
    console.log('\n5. Service Integration Status...');
    const services = [
        { name: 'Azure Graph API', key: 'AZURE_CLIENT_ID' },
        { name: 'OpenAI', key: 'OPENAI_API_KEY' },  
        { name: 'LiveKit', key: 'LIVEKIT_API_KEY' },
        { name: 'Deepgram', key: 'DEEPGRAM_API_KEY' },
        { name: 'ElevenLabs', key: 'ELEVENLABS_API_KEY' }
    ];

    services.forEach(service => {
        const hasKey = process.env[service.key] && 
                      !process.env[service.key].includes('demo_') && 
                      !process.env[service.key].includes('your_');
        console.log(`   ${hasKey ? '✅' : '❌'} ${service.name}: ${hasKey ? 'Configured' : 'Demo/Missing'}`);
    });

    console.log('\n=== Production Validation Complete ===');
    console.log('🎯 Next Steps:');
    console.log('1. Configure Azure Bot messaging endpoint');
    console.log('2. Create and upload Teams app manifest');
    console.log('3. Test bot in Microsoft Teams');
    console.log('4. Monitor performance and optimize');
    
    console.log('\n📋 Configuration Summary:');
    console.log(`   Local URL: http://localhost:5000`);
    console.log(`   Public URL: https://public-houses-look.loca.lt`);
    console.log(`   WebSocket: ws://localhost:8080`);
    console.log(`   Bot Endpoint: https://public-houses-look.loca.lt/api/messages`);
}

validateProductionSetup().catch(console.error);