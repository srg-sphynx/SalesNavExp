const { contextBridge, ipcRenderer } = require('electron');

// Expose secure APIs to renderer
contextBridge.exposeInMainWorld('api', {
    // History
    getHistory: () => ipcRenderer.invoke('get-history'),
    clearHistory: () => ipcRenderer.invoke('clear-history'),

    // Files
    getRecentFiles: () => ipcRenderer.invoke('get-recent-files'),
    openFile: (filepath) => ipcRenderer.invoke('open-file', filepath),
    openOutputFolder: () => ipcRenderer.invoke('open-output-folder'),

    // Logs
    openLogsFolder: () => ipcRenderer.invoke('open-logs-folder'),

    // Settings
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    resetSettings: () => ipcRenderer.invoke('reset-settings'),
    selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),

    // Statistics
    getStats: () => ipcRenderer.invoke('get-stats'),

    // System info (for About dialog)
    getSystemInfo: () => ipcRenderer.invoke('get-system-info'),

    // Browser management
    detectBrowsers: () => ipcRenderer.invoke('detect-browsers'),
    launchBrowser: (opts) => ipcRenderer.invoke('launch-browser', opts),
    launchChrome: () => ipcRenderer.invoke('launch-chrome'), // legacy

    // Google Drive
    driveStatus: () => ipcRenderer.invoke('drive-status'),
    driveConnect: () => ipcRenderer.invoke('drive-connect'),
    driveDisconnect: () => ipcRenderer.invoke('drive-disconnect'),
    driveUpload: (filePath) => ipcRenderer.invoke('drive-upload', filePath),

    // Scraping
    startScraping: (options) => ipcRenderer.invoke('start-scraping', options),
    stopScraping: () => ipcRenderer.invoke('stop-scraping'),
    getScrapeStatus: () => ipcRenderer.invoke('get-scrape-status'),

    // Progress listener
    onProgress: (callback) => {
        ipcRenderer.on('scrape-progress', (event, progress) => callback(progress));
    },

    // Stats listener
    onStats: (callback) => {
        ipcRenderer.on('scrape-stats', (event, stats) => callback(stats));
    },

    // Issue listener (for errors, warnings, skips)
    onIssue: (callback) => {
        ipcRenderer.on('scrape-issue', (event, issue) => callback(issue));
    },

    // Log listener
    onLog: (callback) => {
        ipcRenderer.on('log', (event, log) => callback(log));
    }
});
