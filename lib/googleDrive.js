/**
 * Google Drive Integration Module
 * Handles OAuth authentication and file uploads to Google Drive
 */

const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const { shell } = require('electron');
const Store = require('electron-store');
const fs = require('fs').promises;
const path = require('path');

// Secure token storage
const store = new Store({
    name: 'google-drive-tokens',
    encryptionKey: 'linkedin-scraper-v2-key'
});

// OAuth2 scopes
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

// OAuth2 client instance
let oauth2Client = null;

/**
 * Initialize OAuth2 client with credentials
 */
function initializeClient(credentials) {
    const { client_id, client_secret } = credentials.installed || credentials.web;

    oauth2Client = new google.auth.OAuth2(
        client_id,
        client_secret,
        'http://localhost:3847/callback'
    );

    // Load stored tokens if available
    const tokens = store.get('tokens');
    if (tokens) {
        oauth2Client.setCredentials(tokens);
    }

    // Setup token refresh listener
    oauth2Client.on('tokens', (tokens) => {
        if (tokens.refresh_token) {
            store.set('tokens', tokens);
        } else {
            const existingTokens = store.get('tokens');
            store.set('tokens', { ...existingTokens, ...tokens });
        }
    });

    return oauth2Client;
}

/**
 * Check if user is authenticated
 */
function isAuthenticated() {
    const tokens = store.get('tokens');
    return tokens && (tokens.access_token || tokens.refresh_token);
}

/**
 * Get the current auth status
 */
function getAuthStatus() {
    return {
        connected: isAuthenticated(),
        email: store.get('userEmail') || null
    };
}

/**
 * Authenticate with Google OAuth
 * Opens browser for user consent and handles callback
 */
async function authenticate(credentials) {
    return new Promise((resolve, reject) => {
        try {
            initializeClient(credentials);

            // Generate auth URL
            const authUrl = oauth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: SCOPES,
                prompt: 'consent'
            });

            // Create local server to handle callback
            const server = http.createServer(async (req, res) => {
                try {
                    const queryObject = url.parse(req.url, true).query;

                    if (queryObject.code) {
                        // Exchange code for tokens
                        const { tokens } = await oauth2Client.getToken(queryObject.code);
                        oauth2Client.setCredentials(tokens);
                        store.set('tokens', tokens);

                        // Get user email
                        try {
                            const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
                            const userInfo = await oauth2.userinfo.get();
                            store.set('userEmail', userInfo.data.email);
                        } catch (e) {
                            console.log('Could not get user email:', e.message);
                        }

                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end(`
                            <html>
                            <head>
                                <style>
                                    body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: linear-gradient(135deg, #1e3a5f, #2d1b4e); color: white; margin: 0; }
                                    .container { text-align: center; }
                                    h1 { font-size: 48px; margin-bottom: 16px; }
                                    p { opacity: 0.8; }
                                </style>
                            </head>
                            <body>
                                <div class="container">
                                    <h1>✅</h1>
                                    <h2>Connected to Google Drive!</h2>
                                    <p>You can close this window and return to the app.</p>
                                </div>
                            </body>
                            </html>
                        `);

                        server.close();
                        resolve({ success: true, email: store.get('userEmail') });
                    } else if (queryObject.error) {
                        res.writeHead(400, { 'Content-Type': 'text/html' });
                        res.end(`<h1>Authentication failed: ${queryObject.error}</h1>`);
                        server.close();
                        reject(new Error(queryObject.error));
                    }
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'text/html' });
                    res.end(`<h1>Error: ${err.message}</h1>`);
                    server.close();
                    reject(err);
                }
            });

            server.listen(3847, () => {
                // Open browser for authentication
                shell.openExternal(authUrl);
            });

            // Timeout after 5 minutes
            setTimeout(() => {
                server.close();
                reject(new Error('Authentication timeout'));
            }, 5 * 60 * 1000);

        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Disconnect from Google Drive
 */
function disconnect() {
    store.delete('tokens');
    store.delete('userEmail');
    store.delete('folderId');
    oauth2Client = null;
    return { success: true };
}

/**
 * Ensure the LinkedIn Scraper folder exists in Drive
 */
async function ensureDriveFolder(folderName = 'LinkedIn Scraper') {
    if (!oauth2Client) {
        throw new Error('Not authenticated');
    }

    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // Check if folder already exists
    const cachedFolderId = store.get('folderId');
    if (cachedFolderId) {
        try {
            await drive.files.get({ fileId: cachedFolderId });
            return cachedFolderId;
        } catch {
            // Folder might have been deleted, create new one
            store.delete('folderId');
        }
    }

    // Search for existing folder
    const response = await drive.files.list({
        q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name)'
    });

    if (response.data.files.length > 0) {
        const folderId = response.data.files[0].id;
        store.set('folderId', folderId);
        return folderId;
    }

    // Create new folder
    const folderMetadata = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
    };

    const folder = await drive.files.create({
        resource: folderMetadata,
        fields: 'id'
    });

    store.set('folderId', folder.data.id);
    return folder.data.id;
}

/**
 * Upload a file to Google Drive
 */
async function uploadFile(filePath, fileName = null) {
    if (!oauth2Client) {
        throw new Error('Not authenticated');
    }

    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // Ensure folder exists
    const folderId = await ensureDriveFolder();

    // Read file
    const fileContent = await fs.readFile(filePath);
    const actualFileName = fileName || path.basename(filePath);

    // Determine MIME type
    const ext = path.extname(actualFileName).toLowerCase();
    const mimeTypes = {
        '.csv': 'text/csv',
        '.json': 'application/json',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
    const mimeType = mimeTypes[ext] || 'application/octet-stream';

    // Upload file
    const response = await drive.files.create({
        requestBody: {
            name: actualFileName,
            parents: [folderId]
        },
        media: {
            mimeType,
            body: require('stream').Readable.from(fileContent)
        },
        fields: 'id, name, webViewLink'
    });

    return {
        success: true,
        fileId: response.data.id,
        fileName: response.data.name,
        webViewLink: response.data.webViewLink
    };
}

/**
 * List files in the LinkedIn Scraper folder
 */
async function listFiles() {
    if (!oauth2Client) {
        throw new Error('Not authenticated');
    }

    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const folderId = await ensureDriveFolder();

    const response = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'files(id, name, createdTime, size, webViewLink)',
        orderBy: 'createdTime desc',
        pageSize: 20
    });

    return response.data.files;
}

module.exports = {
    initializeClient,
    isAuthenticated,
    getAuthStatus,
    authenticate,
    disconnect,
    uploadFile,
    listFiles
};
