const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const os = require('os');
const { spawn, exec } = require('child_process');
const fs = require('fs').promises;

// State
let browserProcess = null;
let mainWindow = null;
let isScrapingActive = false;
let shouldStopScraping = false;
let currentLeads = [];
let lastScrapeStats = null;
let activeBrowserType = 'chrome';

// Paths
const DEFAULT_OUTPUT_DIR = path.join(app.getPath('downloads'), 'LinkedIn Scraper');
const LOGS_DIR = path.join(app.getPath('userData'), 'logs');
const HISTORY_FILE = path.join(app.getPath('userData'), 'history.json');
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const STATS_FILE = path.join(app.getPath('userData'), 'stats.json');
const CHROME_DEBUG_PORT = 9222;

// Default settings
const DEFAULT_SETTINGS = {
    outputDir: '',
    maxLeadsPerScrape: 200,
    delayBetweenLeads: 1500,
    autoOpenFileAfterScrape: true,
    includeTimestampInFilename: true,
    csvSeparator: ','
};

// Logging system
async function ensureLogsDir() {
    try {
        await fs.mkdir(LOGS_DIR, { recursive: true });
    } catch (err) {
        if (err.code !== 'EEXIST') throw err;
    }
}

async function writeLog(level, message, details = null) {
    await ensureLogsDir();
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}${details ? ' - ' + details : ''}\n`;
    const logFile = path.join(LOGS_DIR, `scraper_${new Date().toISOString().slice(0, 10)}.log`);

    try {
        await fs.appendFile(logFile, logLine);
    } catch (err) {
        console.error('Failed to write log:', err);
    }

    console.log(logLine.trim());

    if (mainWindow) {
        mainWindow.webContents.send('log', { level, message, timestamp });
    }
}

function log(msg) { writeLog('info', msg); }
function logError(msg, err) { writeLog('error', msg, err?.message || err); }

// Settings management
async function loadSettings() {
    try {
        const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
        return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

async function saveSettings(settings) {
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// Statistics management
async function loadStats() {
    try {
        const data = await fs.readFile(STATS_FILE, 'utf-8');
        return JSON.parse(data);
    } catch {
        return {
            totalLeadsScraped: 0,
            totalScrapes: 0,
            totalTimeSeconds: 0,
            dailyStats: [],
            weeklyStats: [],
            monthlyStats: []
        };
    }
}

async function saveStats(stats) {
    await fs.writeFile(STATS_FILE, JSON.stringify(stats, null, 2));
}

async function updateStats(scrapeStats) {
    const stats = await loadStats();
    const today = new Date().toISOString().slice(0, 10);

    // Update totals
    stats.totalLeadsScraped += scrapeStats.totalLeads;
    stats.totalScrapes += 1;
    stats.totalTimeSeconds += scrapeStats.totalTime;

    // Update daily stats
    const todayIndex = stats.dailyStats.findIndex(d => d.date === today);
    if (todayIndex >= 0) {
        stats.dailyStats[todayIndex].leads += scrapeStats.totalLeads;
        stats.dailyStats[todayIndex].scrapes += 1;
    } else {
        stats.dailyStats.push({
            date: today,
            leads: scrapeStats.totalLeads,
            scrapes: 1
        });
    }

    // Keep only last 30 days
    stats.dailyStats = stats.dailyStats.slice(-30);

    // Calculate weekly stats (last 4 weeks)
    const weeklyMap = {};
    stats.dailyStats.forEach(day => {
        const weekStart = getWeekStart(new Date(day.date));
        if (!weeklyMap[weekStart]) {
            weeklyMap[weekStart] = { week: weekStart, leads: 0, scrapes: 0 };
        }
        weeklyMap[weekStart].leads += day.leads;
        weeklyMap[weekStart].scrapes += day.scrapes;
    });
    stats.weeklyStats = Object.values(weeklyMap).slice(-4);

    await saveStats(stats);
    return stats;
}

function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d.toISOString().slice(0, 10);
}

// Ensure output directory exists
async function ensureOutputDir(settings) {
    const dir = settings?.outputDir || DEFAULT_OUTPUT_DIR;
    try {
        await fs.mkdir(dir, { recursive: true });
    } catch (err) {
        if (err.code !== 'EEXIST') throw err;
    }
    return dir;
}

// Create the main window
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 700,
        minWidth: 700,
        minHeight: 550,
        titleBarStyle: 'hiddenInset',
        backgroundColor: '#00000000',
        transparent: true,
        vibrancy: 'under-window',
        visualEffectState: 'active',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    const isDev = process.argv.includes('--dev');

    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, 'frontend/dist/index.html'));
    }
}

// Load history from file
async function loadHistory() {
    try {
        const data = await fs.readFile(HISTORY_FILE, 'utf-8');
        return JSON.parse(data);
    } catch {
        return [];
    }
}

// Save history to file
async function saveHistory(history) {
    await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
}

// Get recent output files
async function getRecentFiles() {
    try {
        const settings = await loadSettings();
        const outputDir = await ensureOutputDir(settings);
        const files = await fs.readdir(outputDir);
        const csvFiles = files.filter(f => f.endsWith('.csv'));

        const fileDetails = await Promise.all(
            csvFiles.map(async (filename) => {
                const filepath = path.join(outputDir, filename);
                const stats = await fs.stat(filepath);
                return {
                    name: filename,
                    path: filepath,
                    size: stats.size,
                    date: stats.mtime.toISOString()
                };
            })
        );

        return fileDetails.sort((a, b) => new Date(b.date) - new Date(a.date));
    } catch {
        return [];
    }
}

// Kill any existing debug instances on the CDP port
function killExistingDebugPort() {
    return new Promise((resolve) => {
        exec(`lsof -ti:${CHROME_DEBUG_PORT} | xargs kill -9 2>/dev/null || true`, () => {
            setTimeout(resolve, 1000);
        });
    });
}

// Browser path registry
const BROWSER_PATHS = {
    chrome: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    firefox: '/Applications/Firefox.app/Contents/MacOS/firefox',
    brave: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    edge: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
};

// Launch a browser with remote debugging
async function launchBrowser(browserType = 'chrome') {
    log(`Killing any existing debug sessions on port ${CHROME_DEBUG_PORT}...`);
    await killExistingDebugPort();
    activeBrowserType = browserType;

    return new Promise((resolve) => {
        const browserPath = BROWSER_PATHS[browserType];
        if (!browserPath) {
            log(`Unknown browser type: ${browserType}`);
            resolve(false);
            return;
        }

        log(`Launching ${browserType} with debug port ${CHROME_DEBUG_PORT}...`);

        let args;
        if (browserType === 'firefox') {
            const profileDir = path.join(app.getPath('userData'), 'firefox-profile');
            args = [
                `--remote-debugging-port=${CHROME_DEBUG_PORT}`,
                `--profile`, profileDir,
                '--no-remote',
                'https://www.linkedin.com/sales/home'
            ];
        } else {
            const profileDir = path.join(app.getPath('userData'), `${browserType}-profile`);
            args = [
                `--remote-debugging-port=${CHROME_DEBUG_PORT}`,
                `--user-data-dir=${profileDir}`,
                '--no-first-run',
                '--no-default-browser-check',
                'https://www.linkedin.com/sales/home'
            ];
        }

        browserProcess = spawn(browserPath, args, {
            detached: true,
            stdio: 'ignore'
        });

        browserProcess.unref();

        const waitTime = browserType === 'firefox' ? 4000 : 3000;
        setTimeout(() => {
            log(`${browserType} launched successfully`);
            resolve(true);
        }, waitTime);
    });
}

// Kill active browser process
function killBrowser() {
    if (browserProcess) {
        browserProcess.kill();
        browserProcess = null;
    }
}

// Check if Chrome debug port is available
async function checkChromeDebugPort() {
    return new Promise((resolve) => {
        const http = require('http');
        const req = http.get(`http://localhost:${CHROME_DEBUG_PORT}/json/version`, () => {
            resolve(true);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(2000, () => {
            req.destroy();
            resolve(false);
        });
    });
}

// Clean and format name
function cleanName(name) {
    if (!name) return '';
    // Remove extra whitespace and trim
    return name.replace(/\s+/g, ' ').trim();
}

// Clean and format URL
function cleanUrl(url) {
    if (!url) return '';
    // Remove tracking parameters and clean up
    try {
        const parsed = new URL(url);
        // Keep only the path for LinkedIn URLs
        if (parsed.hostname.includes('linkedin.com')) {
            return `https://www.linkedin.com${parsed.pathname}`;
        }
        return url;
    } catch {
        return url;
    }
}

// Save leads to file with clean formatting
async function saveLeadsToFile(leads, listName, isPartial = false) {
    const settings = await loadSettings();
    const outputDir = await ensureOutputDir(settings);

    // Generate filename
    let filename;
    if (settings.includeTimestampInFilename) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const suffix = isPartial ? '_partial' : '';
        const safeName = listName.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
        filename = `${safeName}_${timestamp}${suffix}.csv`;
    } else {
        const safeName = listName.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50);
        const suffix = isPartial ? '_partial' : '';
        filename = `${safeName}${suffix}.csv`;
    }

    const filepath = path.join(outputDir, filename);

    // Create clean CSV with proper formatting - Name and URL only
    const headers = ['Name', 'LinkedIn Profile URL'];
    const sep = settings.csvSeparator || ',';

    const csvRows = [
        headers.join(sep),
        ...leads.map(lead => {
            const name = cleanName(lead.name);
            const url = cleanUrl(lead.profileUrl);

            // Escape fields if they contain separator or quotes
            const escape = (str) => {
                if (str.includes(sep) || str.includes('"') || str.includes('\n')) {
                    return `"${str.replace(/"/g, '""')}"`;
                }
                return str;
            };

            return [escape(name), escape(url)].join(sep);
        })
    ];

    await fs.writeFile(filepath, csvRows.join('\n'), 'utf-8');
    log(`Saved ${leads.length} leads to: ${filepath}`);

    // Update history
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

    // Auto open if setting enabled
    if (settings.autoOpenFileAfterScrape && !isPartial) {
        shell.showItemInFolder(filepath);
    }

    return { filename, filepath };
}

// IPC Handlers
ipcMain.handle('get-history', async () => {
    return await loadHistory();
});

ipcMain.handle('get-recent-files', async () => {
    return await getRecentFiles();
});

ipcMain.handle('get-settings', async () => {
    return await loadSettings();
});

ipcMain.handle('save-settings', async (event, settings) => {
    await saveSettings(settings);
    return { success: true };
});

ipcMain.handle('get-stats', async () => {
    return await loadStats();
});

ipcMain.handle('reset-settings', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS });
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
    shell.openPath(LOGS_DIR);
});

// Google Drive handlers
ipcMain.handle('drive-status', async () => {
    const googleDrive = require('./lib/googleDrive');
    return googleDrive.getAuthStatus();
});

ipcMain.handle('drive-connect', async () => {
    const googleDrive = require('./lib/googleDrive');

    // Look for credentials in multiple locations
    const possiblePaths = [
        path.join(__dirname, 'credentials.json'),
        path.join(app.getAppPath(), 'credentials.json'),
        path.join(app.getAppPath(), '..', 'credentials.json'),
        path.join(process.resourcesPath || '', 'credentials.json'),
        // For packaged app - check Contents folder
        path.join(app.getAppPath(), '..', '..', 'credentials.json')
    ];

    // Also check for the full client_secret filename pattern
    const contentsPath = path.join(app.getAppPath(), '..', '..');
    try {
        const contentsFiles = await fs.readdir(contentsPath);
        const clientSecretFile = contentsFiles.find(f => f.startsWith('client_secret') && f.endsWith('.json'));
        if (clientSecretFile) {
            possiblePaths.unshift(path.join(contentsPath, clientSecretFile));
        }
    } catch { }

    let credentialsData = null;
    let usedPath = null;

    for (const credPath of possiblePaths) {
        try {
            credentialsData = await fs.readFile(credPath, 'utf-8');
            usedPath = credPath;
            log(`Found credentials at: ${credPath}`);
            break;
        } catch { }
    }

    if (!credentialsData) {
        return { success: false, error: 'Please add credentials.json to the app folder' };
    }

    try {
        const credentials = JSON.parse(credentialsData);
        return await googleDrive.authenticate(credentials);
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('drive-disconnect', async () => {
    const googleDrive = require('./lib/googleDrive');
    return googleDrive.disconnect();
});

ipcMain.handle('drive-upload', async (event, filePath) => {
    const googleDrive = require('./lib/googleDrive');

    try {
        // Look for credentials in multiple locations (same as drive-connect)
        const possiblePaths = [
            path.join(__dirname, 'credentials.json'),
            path.join(app.getAppPath(), 'credentials.json'),
            path.join(app.getAppPath(), '..', 'credentials.json'),
            path.join(process.resourcesPath || '', 'credentials.json'),
            path.join(app.getAppPath(), '..', '..', 'credentials.json')
        ];

        // Also check for the full client_secret filename pattern
        const contentsPath = path.join(app.getAppPath(), '..', '..');
        try {
            const contentsFiles = await fs.readdir(contentsPath);
            const clientSecretFile = contentsFiles.find(f => f.startsWith('client_secret') && f.endsWith('.json'));
            if (clientSecretFile) {
                possiblePaths.unshift(path.join(contentsPath, clientSecretFile));
            }
        } catch { }

        let credentialsData = null;
        for (const credPath of possiblePaths) {
            try {
                credentialsData = await fs.readFile(credPath, 'utf-8');
                log(`Found credentials at: ${credPath}`);
                break;
            } catch { }
        }

        if (!credentialsData) {
            return { success: false, error: 'Credentials not found' };
        }

        const credentials = JSON.parse(credentialsData);
        googleDrive.initializeClient(credentials);

        return await googleDrive.uploadFile(filePath);
    } catch (err) {
        log(`Drive upload error: ${err.message}`);
        return { success: false, error: err.message };
    }
});

// Legacy chrome launch (kept for backward compat)
ipcMain.handle('launch-chrome', async () => {
    await launchBrowser('chrome');
    return { port: CHROME_DEBUG_PORT };
});

// New generic browser launch
ipcMain.handle('launch-browser', async (event, { browserType }) => {
    await launchBrowser(browserType || 'chrome');
    return { port: CHROME_DEBUG_PORT, browserType };
});

// Detect available browsers
ipcMain.handle('detect-browsers', async () => {
    const fsSync = require('fs');
    return Object.entries(BROWSER_PATHS).map(([id, browserPath]) => {
        let available = false;
        try {
            fsSync.accessSync(browserPath, fsSync.constants.X_OK);
            available = true;
        } catch { }
        const names = { chrome: 'Google Chrome', firefox: 'Firefox', brave: 'Brave', edge: 'Microsoft Edge' };
        return { id, name: names[id] || id, available, path: browserPath };
    });
});

// System info for About dialog
ipcMain.handle('get-system-info', async () => {
    const cpus = os.cpus();
    const rawModel = cpus?.[0]?.model || '';
    // On Apple Silicon: "Apple M4 Pro" / "Apple M4", on Intel: long string
    let chip = rawModel;
    // Simplify Intel chip strings
    if (!rawModel.startsWith('Apple')) {
        const match = rawModel.match(/Intel\(R\) Core\(TM\) (i[0-9]-[^\s]+)/i);
        chip = match ? `Intel Core ${match[1]}` : rawModel.split('@')[0].trim();
    }
    return {
        chip,
        platform: os.platform(),
        arch: os.arch(),
        totalMemGB: Math.round(os.totalmem() / (1024 ** 3))
    };
});

// Clear scrape history
ipcMain.handle('clear-history', async () => {
    await saveHistory([]);
    return { success: true };
});

ipcMain.handle('stop-scraping', async () => {
    log('Stop requested by user - setting stop flag');
    shouldStopScraping = true;
    return { success: true, stopping: true };
});

ipcMain.handle('get-scrape-status', async () => {
    return {
        isActive: isScrapingActive,
        progress: lastScrapeStats,
        leadsCount: currentLeads.length
    };
});

ipcMain.handle('start-scraping', async (event, options) => {
    log('Starting scraping process...');
    isScrapingActive = true;
    shouldStopScraping = false;
    currentLeads = [];

    const settings = await loadSettings();

    try {
        log('Checking Chrome debug port...');
        const isAvailable = await checkChromeDebugPort();

        if (!isAvailable) {
            throw new Error('Chrome debug port not available. Please click "Launch Chrome" first.');
        }

        log('Connecting to Chrome via CDP...');
        const { chromium } = require('playwright');

        const browser = await chromium.connectOverCDP(`http://localhost:${CHROME_DEBUG_PORT}`);
        log('Connected to Chrome!');

        const contexts = browser.contexts();
        log(`Found ${contexts.length} browser contexts`);

        if (contexts.length === 0) {
            throw new Error('No browser contexts found. Please open a page in Chrome first.');
        }

        const context = contexts[0];
        const pages = context.pages();
        log(`Found ${pages.length} pages`);

        let page = pages.find(p => p.url().includes('linkedin.com/sales'));
        if (!page && pages.length > 0) {
            page = pages[0];
        }

        if (!page) {
            throw new Error('No page found. Please open LinkedIn Sales Navigator in Chrome.');
        }

        log(`Using page: ${page.url()}`);

        if (options.url) {
            log(`Navigating to: ${options.url}`);
            await page.goto(options.url);
            await page.waitForLoadState('networkidle');
        }

        log('Starting scraper...');
        const { scrapeLeadsWithProgress } = require('./lib/scraper');

        let scrapeStats = null;

        const leads = await scrapeLeadsWithProgress(page, {
            maxLeads: options.maxLeads || settings.maxLeadsPerScrape || 200,
            onProgress: (progress) => {
                lastScrapeStats = progress; // Update session memory
                mainWindow.webContents.send('scrape-progress', progress);
            },
            shouldStop: () => shouldStopScraping,
            onLeadScraped: (lead) => {
                currentLeads.push(lead);
            },
            onStats: (stats) => {
                scrapeStats = stats;
                mainWindow.webContents.send('scrape-stats', stats);
            },
            onIssue: (issue) => {
                log(`[${issue.type.toUpperCase()}] ${issue.message}`);
                mainWindow.webContents.send('scrape-issue', issue);
            }
        });

        log(`Scraped ${leads.length} leads`);
        isScrapingActive = false;
        lastScrapeStats = null; // Clear session memory on completion

        // Update statistics
        if (scrapeStats) {
            await updateStats(scrapeStats);
        }

        if (shouldStopScraping) {
            const result = await saveLeadsToFile(leads, options.listName || 'Stopped Scrape', true);

            // Notify UI with filepath
            mainWindow.webContents.send('scrape-progress', {
                phase: 'stopped',
                totalLeads: leads.length,
                filepath: result.filepath
            });

            return { success: true, count: leads.length, filepath: result.filepath, stopped: true };
        }

        const result = await saveLeadsToFile(leads, options.listName || 'LinkedIn Leads', false);

        // Notify UI with filepath
        mainWindow.webContents.send('scrape-progress', {
            phase: 'complete',
            totalLeads: leads.length,
            filepath: result.filepath
        });

        return { success: true, count: leads.length, filepath: result.filepath };

    } catch (error) {
        logError('Scraping error', error);
        isScrapingActive = false;

        if (currentLeads.length > 0) {
            const result = await saveLeadsToFile(currentLeads, 'Error Recovery', true);
            return {
                success: false,
                error: error.message,
                partialSave: true,
                count: currentLeads.length,
                filepath: result.filepath
            };
        }

        return { success: false, error: error.message };
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
    const settings = await loadSettings();
    const outputDir = await ensureOutputDir(settings);
    shell.openPath(outputDir);
});

// App lifecycle
app.whenReady().then(async () => {
    const settings = await loadSettings();
    await ensureOutputDir(settings);
    await ensureLogsDir();
    log('App started');
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    killBrowser();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    log('App closing');
    killBrowser();
});
