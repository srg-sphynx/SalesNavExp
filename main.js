const { app, BrowserWindow, ipcMain, shell, dialog, nativeTheme } = require('electron');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn, execFile } = require('child_process');
const fsSync = require('fs');
const fs = require('fs').promises;

// State
let browserProcess = null;
let mainWindow = null;
let isScrapingActive = false;
let shouldStopScraping = false;
let currentLeads = [];
let lastScrapeStats = null;

// Paths
const DEFAULT_OUTPUT_DIR = path.join(app.getPath('downloads'), 'LinkedIn Scraper');
const USER_DATA = app.getPath('userData');
const LOGS_DIR = path.join(USER_DATA, 'logs');
const HISTORY_FILE = path.join(USER_DATA, 'history.json');
const SETTINGS_FILE = path.join(USER_DATA, 'settings.json');
const STATS_FILE = path.join(USER_DATA, 'stats.json');
const CDP_PORT = 9222;
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`; // not "localhost": Node resolves that to ::1 first, Chrome listens on IPv4
const SALES_NAV_HOME = 'https://www.linkedin.com/sales/home';

// Default settings
const DEFAULT_SETTINGS = {
    outputDir: '',
    maxLeadsPerScrape: 200,
    delayBetweenLeads: 1500,
    autoOpenFileAfterScrape: true,
    includeTimestampInFilename: true,
    csvSeparator: ','
};

// Local (not UTC) YYYY-MM-DD, so "today" matches the user's calendar
function localDateKey(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function sendToRenderer(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
    }
}

// Logging system
async function ensureLogsDir() {
    await fs.mkdir(LOGS_DIR, { recursive: true });
}

async function writeLog(level, message, details = null) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}${details ? ' - ' + details : ''}\n`;
    const logFile = path.join(LOGS_DIR, `scraper_${localDateKey()}.log`);

    try {
        await ensureLogsDir();
        await fs.appendFile(logFile, logLine);
    } catch (err) {
        console.error('Failed to write log:', err);
    }

    console.log(logLine.trim());
    sendToRenderer('log', { level, message, timestamp });
}

function log(msg) { writeLog('info', msg); }
function logError(msg, err) { writeLog('error', msg, err?.message || err); }

// JSON file helpers
async function readJson(file, fallback) {
    try {
        return JSON.parse(await fs.readFile(file, 'utf-8'));
    } catch {
        return fallback;
    }
}

async function writeJson(file, data) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data, null, 2));
}

// Settings management
const clampInt = (value, min, max, fallback) => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};

function sanitizeSettings(input = {}) {
    const s = { ...DEFAULT_SETTINGS, ...input };
    return {
        outputDir: typeof s.outputDir === 'string' ? s.outputDir : '',
        maxLeadsPerScrape: clampInt(s.maxLeadsPerScrape, 1, 2000, DEFAULT_SETTINGS.maxLeadsPerScrape),
        delayBetweenLeads: clampInt(s.delayBetweenLeads, 500, 10000, DEFAULT_SETTINGS.delayBetweenLeads),
        autoOpenFileAfterScrape: s.autoOpenFileAfterScrape !== false,
        includeTimestampInFilename: s.includeTimestampInFilename !== false,
        csvSeparator: [',', ';', '\t'].includes(s.csvSeparator) ? s.csvSeparator : ','
    };
}

async function loadSettings() {
    return sanitizeSettings(await readJson(SETTINGS_FILE, {}));
}

async function saveSettings(settings) {
    await writeJson(SETTINGS_FILE, sanitizeSettings(settings));
}

// Statistics management
async function loadStats() {
    return {
        totalLeadsScraped: 0,
        totalScrapes: 0,
        totalTimeSeconds: 0,
        dailyStats: [],
        weeklyStats: [],
        ...(await readJson(STATS_FILE, {}))
    };
}

async function updateStats(scrapeStats) {
    const stats = await loadStats();
    const today = localDateKey();

    stats.totalLeadsScraped += scrapeStats.totalLeads;
    stats.totalScrapes += 1;
    stats.totalTimeSeconds += scrapeStats.totalTime;

    const todayEntry = stats.dailyStats.find(d => d.date === today);
    if (todayEntry) {
        todayEntry.leads += scrapeStats.totalLeads;
        todayEntry.scrapes += 1;
    } else {
        stats.dailyStats.push({ date: today, leads: scrapeStats.totalLeads, scrapes: 1 });
    }

    // Keep only last 30 days
    stats.dailyStats = stats.dailyStats.slice(-30);

    // Weekly totals (last 4 weeks, weeks start on Monday)
    const weeklyMap = {};
    stats.dailyStats.forEach(day => {
        const weekStart = getWeekStart(day.date);
        weeklyMap[weekStart] ??= { week: weekStart, leads: 0, scrapes: 0 };
        weeklyMap[weekStart].leads += day.leads;
        weeklyMap[weekStart].scrapes += day.scrapes;
    });
    stats.weeklyStats = Object.values(weeklyMap).slice(-4);

    await writeJson(STATS_FILE, stats);
    return stats;
}

function getWeekStart(dateKey) {
    const d = new Date(`${dateKey}T00:00:00`);
    const day = d.getDay();
    d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
    return localDateKey(d);
}

// Ensure output directory exists
async function ensureOutputDir(settings) {
    const dir = settings?.outputDir || DEFAULT_OUTPUT_DIR;
    await fs.mkdir(dir, { recursive: true });
    return dir;
}

// Create the main window
function createWindow() {
    const dark = nativeTheme.shouldUseDarkColors;
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 760,
        minWidth: 760,
        minHeight: 560,
        show: false,
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 16, y: 14 },
        backgroundColor: dark ? '#0a0a0a' : '#ffffff',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    mainWindow.once('ready-to-show', () => mainWindow.show());

    // Links open in the user's default browser, never inside the app window
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://')) shell.openExternal(url);
        return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith('file://') && !url.startsWith('http://localhost:5173')) {
            event.preventDefault();
        }
    });

    mainWindow.on('closed', () => { mainWindow = null; });

    if (process.argv.includes('--dev')) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
        mainWindow.loadFile(path.join(__dirname, 'frontend/dist/index.html'));
    }
}

// History
async function loadHistory() {
    const history = await readJson(HISTORY_FILE, []);
    return Array.isArray(history) ? history : [];
}

async function saveHistory(history) {
    await writeJson(HISTORY_FILE, history);
}

// Get recent output files
async function getRecentFiles() {
    try {
        const settings = await loadSettings();
        const outputDir = await ensureOutputDir(settings);
        const files = await fs.readdir(outputDir);

        const fileDetails = await Promise.all(
            files.filter(f => f.endsWith('.csv')).map(async (filename) => {
                const filepath = path.join(outputDir, filename);
                const stats = await fs.stat(filepath);
                return { name: filename, path: filepath, size: stats.size, date: stats.mtime.toISOString() };
            })
        );

        return fileDetails.sort((a, b) => new Date(b.date) - new Date(a.date));
    } catch {
        return [];
    }
}

// ---------------------------------------------------------------------------
// Browser management (Chromium-based browsers only: CDP is required)
// ---------------------------------------------------------------------------

const BROWSERS = {
    chrome: { name: 'Google Chrome', bundle: 'Google Chrome.app/Contents/MacOS/Google Chrome' },
    brave: { name: 'Brave', bundle: 'Brave Browser.app/Contents/MacOS/Brave Browser' },
    edge: { name: 'Microsoft Edge', bundle: 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
    chromium: { name: 'Chromium', bundle: 'Chromium.app/Contents/MacOS/Chromium' }
};

function findBrowserExecutable(browserType) {
    const browser = BROWSERS[browserType];
    if (!browser) return null;
    const candidates = [
        path.join('/Applications', browser.bundle),
        path.join(os.homedir(), 'Applications', browser.bundle)
    ];
    return candidates.find((candidate) => {
        try {
            fsSync.accessSync(candidate, fsSync.constants.X_OK);
            return true;
        } catch {
            return false;
        }
    }) || null;
}

const profileDir = (browserType) => path.join(USER_DATA, `${browserType}-profile`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Returns the /json/version payload if a CDP endpoint is listening, else null
function getDebugPortInfo(timeoutMs = 1500) {
    return new Promise((resolve) => {
        const req = http.get(`${CDP_URL}/json/version`, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
    });
}

async function waitForDebugPort(totalMs) {
    const deadline = Date.now() + totalMs;
    while (Date.now() < deadline) {
        const info = await getDebugPortInfo();
        if (info) return info;
        await sleep(400);
    }
    return null;
}

// PIDs of browser processes using one of this app's dedicated profiles
function findProfilePids(browserType) {
    const escaped = profileDir(browserType).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new Promise((resolve) => {
        // No leading "--" in the pattern, or pgrep parses it as an option
        execFile('pgrep', ['-f', `user-data-dir=${escaped}`], (err, stdout) => {
            resolve(err ? [] : stdout.split('\n').map(Number).filter(Boolean));
        });
    });
}

async function stopProfileBrowsers() {
    const pids = (await Promise.all(Object.keys(BROWSERS).map(findProfilePids))).flat();
    if (pids.length === 0) return;

    log(`Stopping ${pids.length} previous debug browser process(es)...`);
    const signalAll = (signal) => pids.forEach((pid) => {
        try { process.kill(pid, signal); } catch { /* already gone */ }
    });

    // Graceful first so the profile (and LinkedIn login) is saved cleanly
    signalAll('SIGTERM');
    for (let i = 0; i < 20; i++) {
        await sleep(250);
        const alive = pids.filter((pid) => {
            try { process.kill(pid, 0); return true; } catch { return false; }
        });
        if (alive.length === 0) return;
    }
    signalAll('SIGKILL');
    await sleep(500);
}

async function launchBrowser(browserType = 'chrome') {
    const executable = findBrowserExecutable(browserType);
    if (!executable) {
        return { success: false, error: `${BROWSERS[browserType]?.name || browserType} is not installed.` };
    }

    // Reuse a debug browser we already started with this profile
    const existingPids = await findProfilePids(browserType);
    if (existingPids.length > 0 && await getDebugPortInfo()) {
        log(`Reusing running ${browserType} debug session`);
        return { success: true, reused: true };
    }

    await stopProfileBrowsers();

    const foreign = await getDebugPortInfo();
    if (foreign) {
        return {
            success: false,
            error: `Port ${CDP_PORT} is already used by another browser (${foreign.Browser || 'unknown'}). Close it and try again.`
        };
    }

    log(`Launching ${browserType} with remote debugging on port ${CDP_PORT}...`);

    // A non-default --user-data-dir is required: Chrome 136+ ignores
    // --remote-debugging-port for the user's default profile.
    const args = [
        `--remote-debugging-port=${CDP_PORT}`,
        '--remote-debugging-address=127.0.0.1',
        `--user-data-dir=${profileDir(browserType)}`,
        '--no-first-run',
        '--no-default-browser-check',
        SALES_NAV_HOME
    ];

    let spawnError = null;
    browserProcess = spawn(executable, args, { detached: true, stdio: 'ignore' });
    browserProcess.on('error', (err) => { spawnError = err; });
    browserProcess.on('exit', () => { browserProcess = null; });
    browserProcess.unref();

    const info = await waitForDebugPort(20000);
    if (spawnError) {
        return { success: false, error: `Could not start browser: ${spawnError.message}` };
    }
    if (!info) {
        return { success: false, error: 'The browser started but its debug port did not respond. Try again.' };
    }

    log(`${browserType} ready (${info.Browser})`);
    return { success: true, reused: false };
}

function killBrowser() {
    if (browserProcess) {
        try { browserProcess.kill(); } catch { /* already exited */ }
        browserProcess = null;
    }
}

// ---------------------------------------------------------------------------
// CSV output
// ---------------------------------------------------------------------------

function cleanName(name) {
    return name ? name.replace(/\s+/g, ' ').trim() : '';
}

// Strip tracking parameters from LinkedIn URLs
function cleanUrl(url) {
    if (!url) return '';
    try {
        const parsed = new URL(url);
        if (parsed.hostname.endsWith('linkedin.com')) {
            return `https://www.linkedin.com${parsed.pathname}`;
        }
        return url;
    } catch {
        return url;
    }
}

function fileTimestamp(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${localDateKey(date)}T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

async function saveLeadsToFile(leads, listName, isPartial = false) {
    const settings = await loadSettings();
    const outputDir = await ensureOutputDir(settings);

    const suffix = isPartial ? '_partial' : '';
    const safeName = listName.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
    const filename = settings.includeTimestampInFilename
        ? `${safeName.slice(0, 30)}_${fileTimestamp()}${suffix}.csv`
        : `${safeName.slice(0, 50)}${suffix}.csv`;
    const filepath = path.join(outputDir, filename);

    const headers = ['Name', 'Title', 'Company', 'Location', 'LinkedIn Profile URL'];
    const sep = settings.csvSeparator;
    const escape = (value) => {
        const s = value ? String(value) : '';
        return /["\r\n]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const csvRows = [
        headers.join(sep),
        ...leads.map(lead => [
            cleanName(lead.name),
            lead.title,
            lead.company,
            lead.location,
            cleanUrl(lead.profileUrl)
        ].map(escape).join(sep))
    ];

    // UTF-8 BOM so Excel shows accented names correctly
    await fs.writeFile(filepath, '﻿' + csvRows.join('\r\n') + '\r\n', 'utf-8');
    log(`Saved ${leads.length} leads to: ${filepath}`);

    const history = await loadHistory();
    history.unshift({
        id: Date.now(),
        name: listName + (isPartial ? ' (partial)' : ''),
        date: new Date().toISOString(),
        count: leads.length,
        filename,
        filepath
    });
    await saveHistory(history.slice(0, 50));

    if (settings.autoOpenFileAfterScrape && !isPartial) {
        shell.showItemInFolder(filepath);
    }

    return { filename, filepath };
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle('get-history', () => loadHistory());
ipcMain.handle('get-recent-files', () => getRecentFiles());
ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('get-stats', () => loadStats());

ipcMain.handle('save-settings', async (event, settings) => {
    await saveSettings(settings);
    return { success: true };
});

ipcMain.handle('reset-settings', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    return { success: true };
});

ipcMain.handle('clear-history', async () => {
    await saveHistory([]);
    return { success: true };
});

ipcMain.handle('select-output-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Output Folder'
    });
    if (!result.canceled && result.filePaths.length > 0) {
        return { success: true, path: result.filePaths[0] };
    }
    return { success: false };
});

ipcMain.handle('open-logs-folder', async () => {
    await ensureLogsDir();
    await shell.openPath(LOGS_DIR);
});

ipcMain.handle('check-file-exists', async (event, filepath) => {
    if (!filepath) return { exists: false };
    try {
        await fs.access(filepath);
        return { exists: true };
    } catch {
        return { exists: false };
    }
});

ipcMain.handle('open-file', async (event, filepath) => {
    if (!filepath) return { found: false, error: 'No filepath provided' };
    try {
        await fs.access(filepath);
        shell.showItemInFolder(filepath);
        return { found: true };
    } catch {
        return { found: false, error: 'File not found — it may have been moved or deleted.' };
    }
});

ipcMain.handle('open-output-folder', async () => {
    const outputDir = await ensureOutputDir(await loadSettings());
    await shell.openPath(outputDir);
});

ipcMain.handle('get-system-info', () => {
    const rawModel = os.cpus()?.[0]?.model || '';
    let chip = rawModel;
    if (!rawModel.startsWith('Apple')) {
        const match = rawModel.match(/Intel\(R\) Core\(TM\) (i[0-9]-[^\s]+)/i);
        chip = match ? `Intel Core ${match[1]}` : rawModel.split('@')[0].trim();
    }
    return {
        chip,
        platform: os.platform(),
        arch: os.arch(),
        osVersion: process.getSystemVersion(),
        totalMemGB: Math.round(os.totalmem() / (1024 ** 3)),
        appVersion: app.getVersion(),
        electronVersion: process.versions.electron
    };
});

// Google Drive
async function loadDriveCredentials() {
    const candidates = [
        path.join(USER_DATA, 'credentials.json'),
        path.join(process.resourcesPath || '', 'credentials.json'),
        path.join(app.getAppPath(), 'credentials.json'),
        path.join(app.getAppPath(), '..', '..', 'credentials.json')
    ];

    // Also accept an un-renamed client_secret_*.json in the app's Contents folder
    try {
        const contentsPath = path.join(app.getAppPath(), '..', '..');
        const clientSecret = (await fs.readdir(contentsPath)).find(f => f.startsWith('client_secret') && f.endsWith('.json'));
        if (clientSecret) candidates.push(path.join(contentsPath, clientSecret));
    } catch { /* not packaged */ }

    for (const candidate of candidates) {
        try {
            return JSON.parse(await fs.readFile(candidate, 'utf-8'));
        } catch { /* try next */ }
    }
    return null;
}

ipcMain.handle('drive-status', () => require('./lib/googleDrive').getAuthStatus());

ipcMain.handle('drive-connect', async () => {
    const credentials = await loadDriveCredentials();
    if (!credentials) {
        return { success: false, error: `credentials.json not found. Place it in ${USER_DATA}` };
    }
    try {
        return await require('./lib/googleDrive').authenticate(credentials);
    } catch (err) {
        logError('Drive connect failed', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('drive-disconnect', () => require('./lib/googleDrive').disconnect());

ipcMain.handle('drive-upload', async (event, filePath) => {
    const googleDrive = require('./lib/googleDrive');
    try {
        if (!googleDrive.getAuthStatus().connected) {
            return { success: false, error: 'Google Drive is not connected. Connect it in Settings first.' };
        }
        const credentials = await loadDriveCredentials();
        if (!credentials) return { success: false, error: 'credentials.json not found' };
        return await googleDrive.uploadFile(credentials, filePath);
    } catch (err) {
        logError('Drive upload error', err);
        return { success: false, error: err.message };
    }
});

// Browser
ipcMain.handle('launch-browser', async (event, { browserType } = {}) => {
    try {
        return await launchBrowser(browserType || 'chrome');
    } catch (err) {
        logError('Browser launch failed', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('detect-browsers', () =>
    Object.entries(BROWSERS).map(([id, { name }]) => {
        const executable = findBrowserExecutable(id);
        return { id, name, available: Boolean(executable), path: executable };
    })
);

// Scraping
ipcMain.handle('stop-scraping', () => {
    log('Stop requested by user - setting stop flag');
    shouldStopScraping = true;
    return { success: true, stopping: true };
});

ipcMain.handle('get-scrape-status', () => ({
    isActive: isScrapingActive,
    progress: lastScrapeStats,
    leadsCount: currentLeads.length
}));

ipcMain.handle('start-scraping', async (event, options = {}) => {
    if (isScrapingActive) {
        return { success: false, error: 'A scrape is already running.' };
    }

    log('Starting scraping process...');
    isScrapingActive = true;
    shouldStopScraping = false;
    currentLeads = [];
    lastScrapeStats = null;

    const settings = await loadSettings();
    const listName = options.listName?.trim() || 'LinkedIn Leads';
    let browser = null;

    try {
        if (options.url) {
            let parsed;
            try { parsed = new URL(options.url); } catch { /* handled below */ }
            if (!parsed || parsed.protocol !== 'https:' || !parsed.hostname.endsWith('linkedin.com')) {
                throw new Error('The URL must be a https://www.linkedin.com/sales/... link.');
            }
        }

        if (!await waitForDebugPort(4000)) {
            throw new Error('Browser debug port not available. Go back and click "Launch Browser" first.');
        }

        log('Connecting to browser via CDP...');
        const { chromium } = require('playwright-core');
        browser = await chromium.connectOverCDP(CDP_URL, { timeout: 15000 });

        const pages = browser.contexts().flatMap(context => context.pages());
        const page = pages.find(p => p.url().includes('linkedin.com/sales')) || pages[0];
        if (!page) {
            throw new Error('No open tab found. Open LinkedIn Sales Navigator in the launched browser.');
        }

        await page.bringToFront().catch(() => { });
        log(`Using page: ${page.url()}`);

        if (options.url) {
            log(`Navigating to: ${options.url}`);
            await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        }

        const { scrapeLeadsWithProgress } = require('./lib/scraper');
        let scrapeStats = null;

        const leads = await scrapeLeadsWithProgress(page, {
            maxLeads: clampInt(options.maxLeads, 1, 2000, settings.maxLeadsPerScrape),
            delayBetweenLeads: settings.delayBetweenLeads,
            onProgress: (progress) => {
                lastScrapeStats = progress;
                sendToRenderer('scrape-progress', progress);
            },
            shouldStop: () => shouldStopScraping,
            onLeadScraped: (lead) => currentLeads.push(lead),
            onStats: (stats) => {
                scrapeStats = stats;
                sendToRenderer('scrape-stats', stats);
            },
            onIssue: (issue) => {
                log(`[${issue.type.toUpperCase()}] ${issue.message}`);
                sendToRenderer('scrape-issue', issue);
            }
        });

        log(`Scraped ${leads.length} leads`);

        if (leads.length === 0 && !shouldStopScraping) {
            throw new Error(scrapeStats?.emptyReason || 'No leads were found on this page.');
        }

        if (scrapeStats && leads.length > 0) {
            await updateStats(scrapeStats);
        }

        const stopped = shouldStopScraping;
        const result = await saveLeadsToFile(leads, listName, stopped);
        sendToRenderer('scrape-progress', {
            phase: stopped ? 'stopped' : 'complete',
            totalLeads: leads.length,
            filepath: result.filepath
        });

        return { success: true, count: leads.length, filepath: result.filepath, stopped };
    } catch (error) {
        logError('Scraping error', error);

        let failure = { success: false, error: error.message, notified: true };
        if (currentLeads.length > 0) {
            try {
                const result = await saveLeadsToFile(currentLeads, listName, true);
                failure = { ...failure, partialSave: true, count: currentLeads.length, filepath: result.filepath };
            } catch (saveError) {
                logError('Could not save partial results', saveError);
            }
        }

        // Broadcast like complete/stopped so the UI recovers even after a reload
        sendToRenderer('scrape-progress', {
            phase: 'failed',
            error: failure.error,
            totalLeads: failure.count || 0,
            filepath: failure.filepath || null
        });
        return failure;
    } finally {
        isScrapingActive = false;
        lastScrapeStats = null;
        // Disconnects Playwright only; the user's browser window stays open
        if (browser) await browser.close().catch(() => { });
    }
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(async () => {
        await ensureOutputDir(await loadSettings()).catch((err) => logError('Output folder unavailable', err));
        log(`App started (v${app.getVersion()}, Electron ${process.versions.electron}, macOS ${process.getSystemVersion()})`);
        createWindow();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit();
    });

    app.on('before-quit', () => {
        log('App closing');
        shouldStopScraping = true;
        killBrowser();
    });
}
