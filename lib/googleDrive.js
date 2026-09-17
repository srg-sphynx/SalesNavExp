/**
 * Google Drive Integration Module
 * OAuth (loopback + PKCE) and file uploads to Google Drive.
 * Tokens are encrypted with the macOS Keychain via Electron safeStorage.
 */

const { app, shell, safeStorage } = require('electron');
const { OAuth2Client, CodeChallengeMethod } = require('google-auth-library');
const { drive: createDrive } = require('@googleapis/drive');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const FOLDER_NAME = 'LinkedIn Scraper';
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

const STORE_FILE = path.join(app.getPath('userData'), 'drive-auth.bin');
const LEGACY_STORE_FILE = path.join(app.getPath('userData'), 'google-drive-tokens.json');
const LEGACY_STORE_KEY = 'linkedin-scraper-v2-key';

// ---------------------------------------------------------------------------
// Encrypted store: { tokens, email, folderId }
// ---------------------------------------------------------------------------

let cache = null;

// Read tokens saved by v3.2 and earlier (electron-store's AES-256-CBC format)
function readLegacyStore() {
    try {
        const data = fs.readFileSync(LEGACY_STORE_FILE);
        const iv = data.subarray(0, 16);
        const key = crypto.pbkdf2Sync(LEGACY_STORE_KEY, iv.toString(), 10000, 32, 'sha512');
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        const json = Buffer.concat([decipher.update(data.subarray(17)), decipher.final()]).toString('utf8');
        return JSON.parse(json);
    } catch {
        return null;
    }
}

function readStore() {
    if (cache) return cache;
    cache = {};
    try {
        cache = JSON.parse(safeStorage.decryptString(fs.readFileSync(STORE_FILE)));
    } catch {
        const legacy = readLegacyStore();
        if (legacy?.tokens) {
            cache = { tokens: legacy.tokens, email: legacy.userEmail || null, folderId: legacy.folderId || null };
            try {
                writeStore(cache);
                fs.rmSync(LEGACY_STORE_FILE, { force: true });
            } catch { /* keep legacy file; retry migration next launch */ }
        }
    }
    return cache;
}

function writeStore(data) {
    cache = data;
    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Secure storage (Keychain) is not available');
    }
    fs.writeFileSync(STORE_FILE, safeStorage.encryptString(JSON.stringify(data)), { mode: 0o600 });
}

const updateStore = (patch) => writeStore({ ...readStore(), ...patch });

// ---------------------------------------------------------------------------
// OAuth client
// ---------------------------------------------------------------------------

function createClient(credentials, redirectUri) {
    const { client_id, client_secret } = credentials.installed || credentials.web || {};
    if (!client_id) throw new Error('credentials.json is not a valid OAuth client file');

    const client = new OAuth2Client({ clientId: client_id, clientSecret: client_secret, redirectUri });
    const { tokens } = readStore();
    if (tokens) client.setCredentials(tokens);

    // Persist refreshed access tokens (Google only sends refresh_token once)
    client.on('tokens', (fresh) => {
        updateStore({ tokens: { ...readStore().tokens, ...fresh } });
    });
    return client;
}

function getAuthStatus() {
    const { tokens, email } = readStore();
    return {
        connected: Boolean(tokens?.refresh_token || tokens?.access_token),
        email: email || null
    };
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function resultPage(title, message) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:linear-gradient(135deg,#1e3a5f,#2d1b4e);color:#fff;text-align:center}p{opacity:.8}</style>
</head><body><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></div></body></html>`;
}

let pendingAuth = null;

/**
 * Opens the system browser for consent and waits for the loopback redirect.
 */
async function authenticate(credentials) {
    pendingAuth?.cancel();

    return new Promise((resolve, reject) => {
        const state = crypto.randomBytes(16).toString('hex');
        let client = null;
        let codeVerifier = null;
        let redirectUri = null;
        let timer = null;

        const finish = (err, value) => {
            clearTimeout(timer);
            server.close();
            pendingAuth = null;
            err ? reject(err) : resolve(value);
        };

        const server = http.createServer(async (req, res) => {
            const url = new URL(req.url, 'http://127.0.0.1');
            if (url.pathname !== '/callback') {
                res.writeHead(404).end();
                return;
            }

            const send = (status, title, message) => {
                res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(resultPage(title, message));
            };

            if (url.searchParams.get('state') !== state) {
                send(400, 'Authentication failed', 'Invalid state. Please try connecting again from the app.');
                return;
            }

            const error = url.searchParams.get('error');
            if (error) {
                send(400, 'Authentication failed', error);
                finish(new Error(error === 'access_denied' ? 'Access was denied' : error));
                return;
            }

            try {
                const { tokens } = await client.getToken({
                    code: url.searchParams.get('code'),
                    codeVerifier,
                    redirect_uri: redirectUri
                });
                client.setCredentials(tokens);
                updateStore({ tokens, folderId: null });

                let email = null;
                try {
                    const about = await createDrive({ version: 'v3', auth: client }).about.get({ fields: 'user(emailAddress)' });
                    email = about.data.user?.emailAddress || null;
                } catch { /* email is cosmetic */ }
                updateStore({ email });

                send(200, 'Connected to Google Drive', 'You can close this tab and return to LinkedIn Scraper.');
                finish(null, { success: true, email });
            } catch (err) {
                send(500, 'Authentication failed', err.message);
                finish(err);
            }
        });

        server.on('error', (err) => finish(err));

        // Desktop OAuth clients accept any loopback port
        server.listen(0, '127.0.0.1', async () => {
            try {
                redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
                client = createClient(credentials, redirectUri);
                const pkce = await client.generateCodeVerifierAsync();
                codeVerifier = pkce.codeVerifier;

                const authUrl = client.generateAuthUrl({
                    access_type: 'offline',
                    prompt: 'consent',
                    scope: SCOPES,
                    state,
                    code_challenge: pkce.codeChallenge,
                    code_challenge_method: CodeChallengeMethod.S256
                });
                await shell.openExternal(authUrl);
            } catch (err) {
                finish(err);
            }
        });

        timer = setTimeout(() => finish(new Error('Authentication timed out')), AUTH_TIMEOUT_MS);
        pendingAuth = { cancel: () => finish(new Error('Authentication cancelled')) };
    });
}

function disconnect() {
    pendingAuth?.cancel();
    cache = {};
    fs.rmSync(STORE_FILE, { force: true });
    fs.rmSync(LEGACY_STORE_FILE, { force: true });
    return { success: true };
}

// ---------------------------------------------------------------------------
// Drive operations
// ---------------------------------------------------------------------------

async function ensureDriveFolder(drive) {
    const { folderId } = readStore();
    if (folderId) {
        try {
            const { data } = await drive.files.get({ fileId: folderId, fields: 'id, trashed' });
            if (!data.trashed) return folderId;
        } catch { /* deleted — recreate below */ }
    }

    const { data: list } = await drive.files.list({
        q: `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id)',
        spaces: 'drive'
    });

    let id = list.files?.[0]?.id;
    if (!id) {
        const { data } = await drive.files.create({
            requestBody: { name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
            fields: 'id'
        });
        id = data.id;
    }

    updateStore({ folderId: id });
    return id;
}

async function uploadFile(credentials, filePath) {
    if (!getAuthStatus().connected) throw new Error('Not connected to Google Drive');

    const auth = createClient(credentials);
    const drive = createDrive({ version: 'v3', auth });
    const folderId = await ensureDriveFolder(drive);

    const mimeTypes = { '.csv': 'text/csv', '.json': 'application/json' };
    const { data } = await drive.files.create({
        requestBody: { name: path.basename(filePath), parents: [folderId] },
        media: {
            mimeType: mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
            body: fs.createReadStream(filePath)
        },
        fields: 'id, name, webViewLink'
    });

    return { success: true, fileId: data.id, fileName: data.name, webViewLink: data.webViewLink };
}

module.exports = {
    getAuthStatus,
    authenticate,
    disconnect,
    uploadFile
};
