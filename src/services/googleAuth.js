const { google } = require('googleapis');
const User = require('../models/User');

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.REDIRECT_URI
);

// Scopes for Google Tasks
const SCOPES = [
    'https://www.googleapis.com/auth/tasks',
    'https://www.googleapis.com/auth/tasks.readonly'
];

/**
 * Generates the Google OAuth2 URL
 */
const getAuthUrl = () => {
    return oauth2Client.generateAuthUrl({
        access_type: 'offline', // Critical for refreshing tokens
        scope: SCOPES,
        prompt: 'consent' // Force consent to ensure we get a refresh token
    });
};

/**
 * Gets an authenticated OAuth2 client for a user
 * Handles token refresh automatically if possible
 * @param {string} discordId 
 */
const getAuthenticatedClient = async (discordId) => {
    const user = await User.findOne({ discordId });
    if (!user || !user.googleTokens) {
        throw new Error('User not authenticated. Please use /link first.');
    }

    oauth2Client.setCredentials(user.googleTokens);

    // Check if token is expired and refresh if necessary
    // Note: googleapis handles this automatically if a refresh_token is present in credentials
    // We just need to catch errors if headers fail or manually check expiry if we want to be safe.
    // For now, reliance on the library's auto-refresh with 'offline' access_type is standard.

    return oauth2Client;
};

module.exports = {
    oauth2Client,
    getAuthUrl,
    getAuthenticatedClient
};
