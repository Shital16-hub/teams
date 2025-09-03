// meeting-debug-test.js
require('dotenv').config();
const axios = require('axios');

async function debugMeetingManager() {
    console.log('📋 Debugging Meeting Manager...\n');

    const BASE_URL = 'http://localhost:5000';

    // Test 1: Initialize a meeting
    console.log('1. Testing meeting initialization...');
    try {
        const initResponse = await axios.post(`${BASE_URL}/api/meeting/initialize`, {
            meetingId: 'debug-test-meeting',
            participants: [
                {
                    id: 'debug-participant-1',
                    displayName: 'Debug Test User',
                    email: 'debug@test.com'
                }
            ]
        });

        console.log('✅ Meeting initialization successful');
        console.log('   Response:', JSON.stringify(initResponse.data, null, 2));

        // Test 2: Get meeting status
        console.log('\n2. Testing meeting status...');
        const statusResponse = await axios.get(`${BASE_URL}/api/meeting/debug-test-meeting/status`);
        console.log('✅ Meeting status retrieval successful');
        console.log('   Participants:', statusResponse.data.participants?.total || 0);
        console.log('   Status:', statusResponse.data.status);

        // Test 3: Add another participant
        console.log('\n3. Testing participant addition...');
        const addParticipantResponse = await axios.post(`${BASE_URL}/api/meeting/initialize`, {
            meetingId: 'debug-test-meeting',
            participants: [
                {
                    id: 'debug-participant-2',
                    displayName: 'Second Test User',
                    email: 'debug2@test.com'
                }
            ]
        });
        console.log('✅ Additional participant added successfully');

    } catch (error) {
        console.log('❌ Meeting manager test failed');
        console.log('   Status:', error.response?.status);
        console.log('   Error:', error.response?.data?.error || error.message);
        
        if (error.response?.data) {
            console.log('   Details:', JSON.stringify(error.response.data, null, 2));
        }
    }

    // Test 4: Direct component test
    console.log('\n4. Testing internal meeting components...');
    try {
        // Test if the meeting manager module loads correctly
        const MeetingManager = require('./src/teams/MeetingConversationManager');
        const manager = new MeetingManager();
        await manager.initialize();
        console.log('✅ Meeting manager component loads correctly');

        // Test meeting creation directly
        const meetingResult = await manager.initializeMeeting('direct-test-meeting', [
            { id: 'direct-test-user', displayName: 'Direct Test User' }
        ]);
        console.log('✅ Direct meeting creation successful');
        console.log('   Meeting ID:', meetingResult.meetingId);
        
    } catch (componentError) {
        console.log('❌ Meeting manager component error:', componentError.message);
        console.log('   Stack:', componentError.stack);
    }
}

debugMeetingManager().catch(console.error);