// azure-debug-test.js
require('dotenv').config();
const { ConfidentialClientApplication } = require('@azure/msal-node');
const axios = require('axios');

async function debugAzureAuth() {
    console.log('🔍 Debugging Azure Authentication Issues...\n');

    // Test MSAL configuration
    console.log('1. Testing MSAL Configuration...');
    try {
        const msalClient = new ConfidentialClientApplication({
            auth: {
                clientId: process.env.AZURE_CLIENT_ID,
                clientSecret: process.env.AZURE_CLIENT_SECRET,
                authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`
            }
        });

        console.log('✅ MSAL client created successfully');
        console.log(`   Client ID: ${process.env.AZURE_CLIENT_ID?.substring(0, 8)}...`);
        console.log(`   Tenant ID: ${process.env.AZURE_TENANT_ID?.substring(0, 8)}...`);
        console.log(`   Authority: https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`);

        // Test token acquisition
        console.log('\n2. Testing Token Acquisition...');
        const tokenResponse = await msalClient.acquireTokenByClientCredential({
            scopes: ['https://graph.microsoft.com/.default']
        });

        if (tokenResponse?.accessToken) {
            console.log('✅ Access token acquired successfully');
            console.log(`   Token type: ${tokenResponse.tokenType}`);
            console.log(`   Expires on: ${new Date(tokenResponse.expiresOn).toLocaleString()}`);
            console.log(`   Token length: ${tokenResponse.accessToken.length} characters`);

            // Test Microsoft Graph API access
            console.log('\n3. Testing Microsoft Graph API Access...');
            
            // Test 1: Get application info (should work)
            try {
                const appResponse = await axios.get(
                    `https://graph.microsoft.com/v1.0/applications`,
                    {
                        headers: {
                            'Authorization': `Bearer ${tokenResponse.accessToken}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 10000
                    }
                );
                console.log('✅ Microsoft Graph applications endpoint accessible');
                console.log(`   Found ${appResponse.data.value?.length || 0} applications`);
            } catch (graphError) {
                if (graphError.response?.status === 403) {
                    console.log('⚠️  Limited Graph API permissions (expected)');
                    console.log('   This is normal for basic bot applications');
                } else {
                    console.log('❌ Graph API test failed:', graphError.response?.data?.error || graphError.message);
                }
            }

            // Test 2: Test Communications API (for Teams calls)
            console.log('\n4. Testing Communications API...');
            try {
                const callsResponse = await axios.get(
                    'https://graph.microsoft.com/v1.0/communications/calls',
                    {
                        headers: {
                            'Authorization': `Bearer ${tokenResponse.accessToken}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 10000
                    }
                );
                console.log('✅ Communications API accessible');
                console.log(`   Active calls: ${callsResponse.data.value?.length || 0}`);
            } catch (commError) {
                console.log('❌ Communications API failed:', commError.response?.status);
                if (commError.response?.data?.error) {
                    console.log(`   Error: ${commError.response.data.error.code}`);
                    console.log(`   Message: ${commError.response.data.error.message}`);
                    
                    if (commError.response.data.error.code === 'Forbidden') {
                        console.log('\n💡 SOLUTION: Your app needs additional permissions:');
                        console.log('   1. Go to Azure Portal → App registrations → Your app');
                        console.log('   2. Go to API permissions');
                        console.log('   3. Add these Microsoft Graph Application permissions:');
                        console.log('      - Calls.AccessMedia.All');
                        console.log('      - Calls.Initiate.All');
                        console.log('      - Calls.JoinGroupCall.All');
                        console.log('   4. Grant admin consent');
                    }
                }
            }

        } else {
            console.log('❌ Failed to acquire access token');
        }

    } catch (error) {
        console.log('❌ MSAL client creation failed:', error.message);
        
        if (error.message.includes('AADSTS7000215')) {
            console.log('\n💡 SOLUTION: Client secret is invalid or expired');
            console.log('   1. Go to Azure Portal → App registrations → Your app');
            console.log('   2. Go to Certificates & secrets');
            console.log('   3. Delete current secret and create a new one');
            console.log('   4. Update AZURE_CLIENT_SECRET in your .env file');
        } else if (error.message.includes('AADSTS700016')) {
            console.log('\n💡 SOLUTION: Client ID is invalid');
            console.log('   Check your AZURE_CLIENT_ID in the .env file');
        } else if (error.message.includes('AADSTS90002')) {
            console.log('\n💡 SOLUTION: Tenant ID is invalid');
            console.log('   Check your AZURE_TENANT_ID in the .env file');
        }
    }

    // Test Bot Framework configuration
    console.log('\n5. Bot Framework Configuration Check...');
    console.log(`   Teams App ID: ${process.env.TEAMS_APP_ID?.substring(0, 8)}...`);
    console.log(`   Teams App Password: ${process.env.TEAMS_APP_PASSWORD ? '***set***' : 'not set'}`);
    
    if (process.env.TEAMS_APP_ID === process.env.AZURE_CLIENT_ID) {
        console.log('✅ Teams App ID matches Azure Client ID');
    } else {
        console.log('❌ Teams App ID does not match Azure Client ID');
    }

    if (process.env.TEAMS_APP_PASSWORD === process.env.AZURE_CLIENT_SECRET) {
        console.log('✅ Teams App Password matches Azure Client Secret');
    } else {
        console.log('❌ Teams App Password does not match Azure Client Secret');
    }

    console.log('\n=== Debug Summary ===');
    console.log('Check the issues above and apply the suggested solutions.');
    console.log('Most likely fixes:');
    console.log('1. Add Microsoft Graph API permissions in Azure Portal');
    console.log('2. Grant admin consent for the permissions');
    console.log('3. Ensure your bot has the correct scopes configured');
}

debugAzureAuth().catch(console.error);