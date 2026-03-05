// LinkedIn Scraper V3 - App Logic
// Complete UI/UX Overhaul

// ===== STATE =====
let currentSettings = {};
let currentTheme = 'dark';
let currentFilepath = '';
let lastScrapeStats = null;

// ===== THEME MANAGEMENT =====
function loadTheme() {
    const savedTheme = localStorage.getItem('linkedinScraper_theme') || 'dark';
    applyTheme(savedTheme);
}

function applyTheme(theme) {
    currentTheme = theme;

    if (theme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
        document.documentElement.setAttribute('data-theme', theme);
    }

    localStorage.setItem('linkedinScraper_theme', theme);

    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) themeSelect.value = theme;
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (currentTheme === 'system') {
        document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    }
});

// ===== VIEW MANAGEMENT =====
function showView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    const view = document.getElementById(`${viewName}-view`);
    const nav = document.querySelector(`[data-view="${viewName}"]`);

    if (view) view.classList.add('active');
    if (nav) nav.classList.add('active');
}

function showWizardStep(stepId) {
    document.querySelectorAll('.wizard-step').forEach(s => s.classList.remove('active'));
    const step = document.getElementById(stepId);
    if (step) step.classList.add('active');
}

// ===== TOAST =====
function showToast(message, duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ===== INITIALIZATION =====
async function init() {
    loadTheme();
    setupNavigation();
    setupEventListeners();
    setupProgressListener();

    try {
        await Promise.all([
            loadSettings(),
            loadStats(),
            loadHistory(),
            loadFiles()
        ]);
    } catch (err) {
        console.error('Init error:', err);
    }

    checkDriveStatus();
}

// ===== NAVIGATION =====
function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            if (view) showView(view);
        });
    });
}

// ===== EVENT LISTENERS =====
function setupEventListeners() {
    // Quick scrape button
    document.getElementById('quick-scrape-btn')?.addEventListener('click', () => {
        showView('scrape');
        showWizardStep('step-1');
    });

    // Launch Chrome
    document.getElementById('launch-chrome-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('launch-chrome-btn');
        btn.disabled = true;
        btn.innerHTML = '<span>Launching...</span>';

        try {
            await window.api.launchChrome();
            showWizardStep('step-2');
        } catch (err) {
            showToast('Failed to launch Chrome: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <circle cx="12" cy="12" r="4"/>
              </svg> Launch Chrome`;
        }
    });

    // Ready button
    document.getElementById('ready-btn')?.addEventListener('click', async () => {
        const listName = document.getElementById('list-name').value || 'Leads';
        showWizardStep('step-3');

        try {
            await window.api.startScraping({ listName });
        } catch (err) {
            showToast('Scraping error: ' + err.message);
            showWizardStep('step-1');
        }
    });

    // Stop button
    document.getElementById('stop-btn')?.addEventListener('click', async () => {
        await window.api.stopScraping();
    });

    // New scrape button
    document.getElementById('new-scrape-btn')?.addEventListener('click', () => {
        showWizardStep('step-1');
    });

    // Open file button
    document.getElementById('open-file-btn')?.addEventListener('click', () => {
        if (currentFilepath) {
            window.api.openFile(currentFilepath);
        }
    });

    // Save to drive button
    document.getElementById('save-drive-btn')?.addEventListener('click', async () => {
        if (currentFilepath) {
            const result = await window.api.driveUpload(currentFilepath);
            if (result.success) {
                showToast('Saved to Google Drive!');
            } else {
                showToast('Failed to save: ' + result.error);
            }
        }
    });

    // Open folder button
    document.getElementById('open-folder-btn')?.addEventListener('click', () => {
        window.api.openOutputFolder();
    });

    // Open logs button
    document.getElementById('open-logs-btn')?.addEventListener('click', () => {
        window.api.openLogsFolder();
    });

    // Drive sync button
    document.getElementById('drive-sync-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('drive-sync-btn');
        const textEl = document.getElementById('drive-status-text');

        btn.disabled = true;
        textEl.textContent = 'Connecting...';

        try {
            const result = await window.api.driveConnect();
            if (result.success) {
                showToast('Connected to Google Drive!');
                textEl.textContent = 'Disconnect';
                updateDriveStatus(true, result.email);
            } else {
                textEl.textContent = 'Connect Drive';
                showToast('Failed to connect');
            }
        } catch (err) {
            textEl.textContent = 'Connect Drive';
            showToast('Connection error');
        } finally {
            btn.disabled = false;
        }
    });

    // Theme selector
    document.getElementById('theme-select')?.addEventListener('change', (e) => {
        applyTheme(e.target.value);
    });

    // Browse folder
    document.getElementById('browse-folder-btn')?.addEventListener('click', async () => {
        const result = await window.api.selectFolder();
        if (result && result.path) {
            document.getElementById('output-dir').value = result.path;
        }
    });

    // Save settings
    document.getElementById('save-settings-btn')?.addEventListener('click', async () => {
        const settings = {
            outputDir: document.getElementById('output-dir').value,
            csvSeparator: document.getElementById('csv-separator').value,
            maxLeads: parseInt(document.getElementById('max-leads').value) || 200
        };

        await window.api.saveSettings(settings);
        currentSettings = settings;
        showToast('Settings saved!');
        showView('dashboard');
    });

    // Reset settings
    document.getElementById('reset-settings-btn')?.addEventListener('click', async () => {
        await window.api.resetSettings();
        await loadSettings();
        showToast('Settings reset to defaults');
    });

    // Drive connect in settings
    document.getElementById('drive-connect-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('drive-connect-btn');
        btn.disabled = true;
        btn.textContent = 'Connecting...';

        try {
            const status = await window.api.driveStatus();

            if (status.connected) {
                await window.api.driveDisconnect();
                updateDriveStatus(false);
                showToast('Disconnected from Google Drive');
            } else {
                const result = await window.api.driveConnect();
                if (result.success) {
                    updateDriveStatus(true, result.email);
                    showToast('Connected to Google Drive!');
                } else {
                    showToast('Failed to connect: ' + result.error);
                }
            }
        } catch (err) {
            showToast('Error: ' + err.message);
        } finally {
            btn.disabled = false;
        }
    });
}

// ===== PROGRESS LISTENER =====
function setupProgressListener() {
    window.api.onProgress((data) => {
        if (data.phase === 'scraping') {
            document.getElementById('leads-scraped').textContent = data.leadsScraped || 0;
            document.getElementById('scrape-speed').textContent = data.speed?.toFixed(1) || '0';

            const progress = Math.min((data.leadsScraped / (data.maxLeads || 200)) * 100, 100);
            document.getElementById('scrape-progress').style.width = `${progress}%`;
        }

        if (data.phase === 'complete' || data.phase === 'stopped') {
            currentFilepath = data.filepath;
            document.getElementById('complete-message').textContent =
                `Successfully scraped ${data.totalLeads} leads`;
            showWizardStep('step-complete');
            loadStats();
            loadHistory();
            loadFiles();
        }
    });
}

// ===== DATA LOADING =====
async function loadSettings() {
    currentSettings = await window.api.getSettings();

    if (currentSettings.outputDir) {
        document.getElementById('output-dir').value = currentSettings.outputDir;
    }
    if (currentSettings.csvSeparator) {
        document.getElementById('csv-separator').value = currentSettings.csvSeparator;
    }
    if (currentSettings.maxLeads) {
        document.getElementById('max-leads').value = currentSettings.maxLeads;
    }
}

async function loadStats() {
    try {
        const stats = await window.api.getStats();
        document.getElementById('total-leads').textContent = stats.totalLeads || 0;
        document.getElementById('weekly-leads').textContent = stats.weeklyLeads || 0;
        document.getElementById('avg-speed').textContent = stats.avgSpeed?.toFixed(1) || '0';
        document.getElementById('total-files').textContent = stats.totalFiles || 0;
    } catch (err) {
        console.error('Failed to load stats:', err);
    }
}

async function loadHistory() {
    try {
        const history = await window.api.getHistory();
        const container = document.getElementById('history-list');
        const recentContainer = document.getElementById('recent-activity-list');

        if (!history || history.length === 0) {
            container.innerHTML = `<div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 6v6l4 2"/>
                </svg>
                <p>No scraping history yet</p>
            </div>`;
            return;
        }

        container.innerHTML = history.slice(0, 20).map(item => `
            <div class="history-item">
                <div>
                    <strong>${item.name || 'Untitled'}</strong>
                    <p style="color: var(--color-text-muted); font-size: 12px;">
                        ${new Date(item.date).toLocaleDateString()} · ${item.count} leads
                    </p>
                </div>
                <button class="btn btn-ghost" onclick="window.api.openFile('${item.filepath}')">Open</button>
            </div>
        `).join('');

        if (recentContainer) {
            recentContainer.innerHTML = history.slice(0, 5).map(item => `
                <div class="history-item">
                    <div>
                        <strong>${item.name || 'Untitled'}</strong>
                        <p style="color: var(--color-text-muted); font-size: 12px;">
                            ${new Date(item.date).toLocaleDateString()} · ${item.count} leads
                        </p>
                    </div>
                </div>
            `).join('');
        }
    } catch (err) {
        console.error('Failed to load history:', err);
    }
}

async function loadFiles() {
    try {
        const files = await window.api.getFiles();
        const container = document.getElementById('files-list');

        if (!files || files.length === 0) {
            container.innerHTML = `<div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <p>No saved files</p>
            </div>`;
            return;
        }

        container.innerHTML = files.map(file => `
            <div class="file-card" onclick="window.api.openFile('${file.filepath}')">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <div>
                        <strong>${file.name}</strong>
                        <p style="color: var(--color-text-muted); font-size: 12px;">
                            ${file.size} · ${new Date(file.date).toLocaleDateString()}
                        </p>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Failed to load files:', err);
    }
}

// ===== DRIVE STATUS =====
async function checkDriveStatus() {
    try {
        const status = await window.api.driveStatus();
        updateDriveStatus(status.connected, status.email);
    } catch (err) {
        console.error('Failed to check drive status:', err);
    }
}

function updateDriveStatus(connected, email = '') {
    const statusText = document.getElementById('drive-status-text');
    const emailLabel = document.getElementById('drive-email-label');
    const connectBtn = document.getElementById('drive-connect-btn');

    if (statusText) {
        statusText.textContent = connected ? 'Connected' : 'Connect Drive';
    }

    if (emailLabel) {
        emailLabel.textContent = connected ? email : 'Not connected';
    }

    if (connectBtn) {
        connectBtn.textContent = connected ? 'Disconnect' : 'Connect';
    }
}

// ===== START =====
document.addEventListener('DOMContentLoaded', init);
