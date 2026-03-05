// LinkedIn Scraper V3 - App Logic

// State
let currentFilepath = '';
let currentSettings = {};
let lastScrapeStats = null;
let currentIssues = [];
let currentTheme = 'dark';

// Theme management
function loadTheme() {
    const savedTheme = localStorage.getItem('linkedinScraper_theme') || 'dark';
    applyTheme(savedTheme);
}

function applyTheme(theme) {
    currentTheme = theme;

    if (theme === 'system') {
        // Check system preference
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
        document.documentElement.setAttribute('data-theme', theme);
    }

    localStorage.setItem('linkedinScraper_theme', theme);

    // Update selector if it exists
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) {
        themeSelect.value = theme;
    }
}

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (currentTheme === 'system') {
        document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    }
});

// DOM Elements
const views = {
    home: document.getElementById('home-view'),
    stats: document.getElementById('stats-view'),
    settings: document.getElementById('settings-view'),
    scraping: document.getElementById('scraping-view')
};

const steps = {
    launch: document.getElementById('step-launch'),
    login: document.getElementById('step-login'),
    progress: document.getElementById('step-progress'),
    complete: document.getElementById('step-complete'),
    stopped: document.getElementById('step-stopped'),
    error: document.getElementById('step-error')
};

// Initialize app
async function init() {
    // Apply saved theme immediately
    loadTheme();

    // Setup event listeners first so UI is responsive immediately
    setupEventListeners();
    setupProgressListener();
    setupStatsListener();
    setupIssueListener();

    // Then load data (with error handling)
    try {
        await Promise.all([
            loadSettings(),
            loadHistory(),
            loadFiles(),
            loadStats()
        ]);

        // Check if this is first run of V2.0
        checkFirstRun();
    } catch (err) {
        console.error('Init error:', err);
    }
}

// Check for first V2.0 run and show welcome screen
function checkFirstRun() {
    const seenVersion = localStorage.getItem('linkedinScraper_seenVersion');
    const currentVersion = '2.0.0';

    if (seenVersion !== currentVersion) {
        // Show welcome modal
        const welcomeModal = document.getElementById('welcome-modal');
        if (welcomeModal) {
            welcomeModal.classList.remove('hidden');
        }
        // Mark as seen
        localStorage.setItem('linkedinScraper_seenVersion', currentVersion);
    }
}

// Load settings
async function loadSettings() {
    currentSettings = await window.api.getSettings();
    updateSettingsUI();
}

// Update settings UI
function updateSettingsUI() {
    document.getElementById('output-dir').value = currentSettings.outputDir || '';
    document.getElementById('max-leads').value = currentSettings.maxLeadsPerScrape || 200;
    document.getElementById('auto-open').checked = currentSettings.autoOpenFileAfterScrape !== false;
    document.getElementById('include-timestamp').checked = currentSettings.includeTimestampInFilename !== false;
}

// Get settings from UI
function getSettingsFromUI() {
    return {
        outputDir: document.getElementById('output-dir').value,
        maxLeadsPerScrape: parseInt(document.getElementById('max-leads').value) || 200,
        autoOpenFileAfterScrape: document.getElementById('auto-open').checked,
        includeTimestampInFilename: document.getElementById('include-timestamp').checked
    };
}

// Load and display statistics
async function loadStats() {
    const stats = await window.api.getStats();

    // Update summary cards
    document.getElementById('total-leads').textContent = stats.totalLeadsScraped.toLocaleString();
    document.getElementById('total-scrapes').textContent = stats.totalScrapes.toLocaleString();

    // Format time
    const hours = Math.floor(stats.totalTimeSeconds / 3600);
    const minutes = Math.floor((stats.totalTimeSeconds % 3600) / 60);
    document.getElementById('total-time').textContent = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

    // Calculate average speed
    if (stats.totalTimeSeconds > 0) {
        const avgSpeed = Math.round((stats.totalLeadsScraped / (stats.totalTimeSeconds / 60)) * 10) / 10;
        document.getElementById('avg-speed').textContent = avgSpeed.toFixed(1);
    }

    // Render daily chart (last 7 days)
    renderDailyChart(stats.dailyStats);

    // Render weekly stats
    renderWeeklyStats(stats.weeklyStats);
}

// Render daily bar chart
function renderDailyChart(dailyStats) {
    const chartEl = document.getElementById('daily-chart');
    const last7Days = getLast7Days();

    // Map stats to days
    const statsMap = {};
    dailyStats.forEach(d => statsMap[d.date] = d.leads);

    // Find max for scaling
    const values = last7Days.map(d => statsMap[d] || 0);
    const maxVal = Math.max(...values, 1);

    chartEl.innerHTML = last7Days.map((date, i) => {
        const leads = statsMap[date] || 0;
        const height = Math.max(4, (leads / maxVal) * 120);
        const dayName = new Date(date).toLocaleDateString('en-US', { weekday: 'short' });

        return `
            <div class="chart-bar">
                <div class="bar-value">${leads > 0 ? leads : ''}</div>
                <div class="bar-fill" style="height: ${height}px"></div>
                <div class="bar-label">${dayName}</div>
            </div>
        `;
    }).join('');
}

// Render weekly summary
function renderWeeklyStats(weeklyStats) {
    const weeklyEl = document.getElementById('weekly-stats');

    if (weeklyStats.length === 0) {
        weeklyEl.innerHTML = '<div class="empty-state">No weekly data yet</div>';
        return;
    }

    weeklyEl.innerHTML = weeklyStats.slice(-4).map(week => {
        const weekDate = new Date(week.week);
        const weekLabel = `Week of ${weekDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

        return `
            <div class="week-card">
                <div class="week-label">${weekLabel}</div>
                <div class="week-value">${week.leads}</div>
                <div class="week-sublabel">${week.scrapes} scrape${week.scrapes !== 1 ? 's' : ''}</div>
            </div>
        `;
    }).join('');
}

// Get last 7 days as ISO date strings
function getLast7Days() {
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push(d.toISOString().slice(0, 10));
    }
    return days;
}

// Load history
async function loadHistory() {
    const historyList = document.getElementById('history-list');
    const history = await window.api.getHistory();

    if (history.length === 0) {
        historyList.innerHTML = '<div class="empty-state">No scraping history yet</div>';
        return;
    }

    historyList.innerHTML = history.map(item => `
    <div class="history-item" data-path="${item.filepath || ''}">
      <div class="history-item-info">
        <h3>${escapeHtml(item.name)}</h3>
        <p>${formatDate(item.date)}</p>
      </div>
      <span class="history-item-badge">${item.count} Leads</span>
    </div>
  `).join('');

    historyList.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', () => {
            if (item.dataset.path) {
                window.api.openFile(item.dataset.path);
            }
        });
    });
}

// Load recent files
async function loadFiles() {
    const filesList = document.getElementById('files-list');
    const files = await window.api.getRecentFiles();

    if (files.length === 0) {
        filesList.innerHTML = '<div class="empty-state">No files yet</div>';
        return;
    }

    filesList.innerHTML = files.slice(0, 10).map(file => `
    <div class="file-item">
      <span class="file-icon">📄</span>
      <div class="file-info">
        <h3>${escapeHtml(file.name)}</h3>
        <p>${formatDate(file.date)} • ${formatSize(file.size)}</p>
      </div>
      <button class="file-download" data-path="${escapeHtml(file.path)}" title="Show in Finder">📂</button>
    </div>
  `).join('');

    filesList.querySelectorAll('.file-download').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.api.openFile(btn.dataset.path);
        });
    });
}

// Setup event listeners
function setupEventListeners() {
    // Stats button
    document.getElementById('stats-btn').addEventListener('click', async () => {
        await loadStats();
        showView('stats');
    });

    // Stats back button
    document.getElementById('stats-back-btn').addEventListener('click', () => {
        showView('home');
    });

    // Settings button
    document.getElementById('settings-btn').addEventListener('click', () => {
        showView('settings');
    });

    // Settings back button
    document.getElementById('settings-back-btn').addEventListener('click', () => {
        showView('home');
    });

    // Browse folder button
    document.getElementById('browse-folder-btn').addEventListener('click', async () => {
        const result = await window.api.selectOutputFolder();
        if (result.success) {
            document.getElementById('output-dir').value = result.path;
        }
    });

    // Theme selector
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) {
        themeSelect.value = currentTheme;
        themeSelect.addEventListener('change', (e) => {
            applyTheme(e.target.value);
        });
    }

    // Save settings button
    document.getElementById('save-settings-btn').addEventListener('click', async () => {
        const settings = getSettingsFromUI();
        await window.api.saveSettings(settings);
        currentSettings = settings;
        showToast('Settings saved!');
        showView('home');
        await loadFiles();
    });

    // Reset settings button
    document.getElementById('reset-settings-btn').addEventListener('click', async () => {
        const defaults = {
            outputDir: '',
            maxLeadsPerScrape: 200,
            autoOpenFileAfterScrape: true,
            includeTimestampInFilename: true
        };
        await window.api.saveSettings(defaults);
        currentSettings = await window.api.getSettings();
        updateSettingsUI();
        showToast('Settings reset to defaults');
    });

    // What's New / Changelog button
    const whatsNewBtn = document.getElementById('whats-new-btn');
    const changelogModal = document.getElementById('changelog-modal');
    const changelogClose = document.getElementById('changelog-close');
    const changelogBackdrop = document.getElementById('changelog-backdrop');
    const changelogOkBtn = document.getElementById('changelog-ok-btn');

    if (whatsNewBtn && changelogModal) {
        whatsNewBtn.addEventListener('click', () => {
            changelogModal.classList.remove('hidden');
        });

        const closeChangelog = () => {
            changelogModal.classList.add('hidden');
        };

        if (changelogClose) changelogClose.addEventListener('click', closeChangelog);
        if (changelogBackdrop) changelogBackdrop.addEventListener('click', closeChangelog);
        if (changelogOkBtn) changelogOkBtn.addEventListener('click', closeChangelog);
    }

    // Welcome screen handlers
    const welcomeModal = document.getElementById('welcome-modal');
    const welcomeBackdrop = document.getElementById('welcome-backdrop');
    const welcomeConnectBtn = document.getElementById('welcome-connect-drive-btn');
    const welcomeSkipBtn = document.getElementById('welcome-skip-btn');

    if (welcomeModal) {
        const closeWelcome = () => {
            welcomeModal.classList.add('hidden');
        };

        if (welcomeBackdrop) welcomeBackdrop.addEventListener('click', closeWelcome);
        if (welcomeSkipBtn) welcomeSkipBtn.addEventListener('click', closeWelcome);

        if (welcomeConnectBtn) {
            let welcomeTimeout = null;

            const resetWelcomeBtn = () => {
                welcomeConnectBtn.textContent = '☁️ Connect Google Drive';
                welcomeConnectBtn.disabled = false;
            };

            welcomeConnectBtn.addEventListener('click', async () => {
                welcomeConnectBtn.disabled = true;
                welcomeConnectBtn.textContent = 'Connecting...';

                // Set a 30-second timeout
                welcomeTimeout = setTimeout(() => {
                    welcomeConnectBtn.textContent = '🔄 Retry Connection';
                    welcomeConnectBtn.disabled = false;
                    showToast('Connection timed out. Click to retry.');
                }, 30000);

                try {
                    const result = await window.api.driveConnect();
                    clearTimeout(welcomeTimeout);

                    if (result.success) {
                        closeWelcome();
                        showToast('Google Drive connected successfully!');
                        updateDriveStatus();
                    } else {
                        resetWelcomeBtn();
                        showToast('Connection failed: ' + (result.error || 'Unknown error'));
                    }
                } catch (err) {
                    clearTimeout(welcomeTimeout);
                    resetWelcomeBtn();
                    showToast('Connection failed: ' + err.message);
                }
            });
        }
    }

    // Google Drive connect button
    const driveConnectBtn = document.getElementById('drive-connect-btn');
    const driveDisconnectBtn = document.getElementById('drive-disconnect-btn');

    if (driveConnectBtn) {
        let connectTimeout = null;

        const resetConnectButton = () => {
            driveConnectBtn.disabled = false;
            driveConnectBtn.textContent = 'Connect Google Drive';
        };

        driveConnectBtn.addEventListener('click', async () => {
            driveConnectBtn.disabled = true;
            driveConnectBtn.textContent = 'Connecting...';

            // Set a 30-second timeout
            connectTimeout = setTimeout(() => {
                driveConnectBtn.textContent = 'Retry Connection';
                driveConnectBtn.disabled = false;
                showToast('Connection timed out. Click to retry.');
            }, 30000);

            try {
                const result = await window.api.driveConnect();
                clearTimeout(connectTimeout);

                if (result.success) {
                    showToast('Connected to Google Drive!');
                    updateDriveStatus(true, result.email);
                } else {
                    resetConnectButton();
                    showToast(result.error || 'Failed to connect');
                }
            } catch (err) {
                clearTimeout(connectTimeout);
                resetConnectButton();
                showToast('Connection error: ' + err.message);
            }
        });
    }

    if (driveDisconnectBtn) {
        driveDisconnectBtn.addEventListener('click', async () => {
            await window.api.driveDisconnect();
            updateDriveStatus(false);
            showToast('Disconnected from Google Drive');
        });
    }

    // Check Drive status on load
    checkDriveStatus();

    // New scraping button
    document.getElementById('new-scrape-btn').addEventListener('click', () => {
        showView('scraping');
        showStep('launch');
        document.getElementById('launch-chrome-btn').disabled = false;
        document.getElementById('launch-chrome-btn').textContent = 'Launch Chrome';
        document.getElementById('leads-url').value = '';
        document.getElementById('list-name').value = '';
    });

    // Back button
    document.getElementById('back-btn').addEventListener('click', () => {
        showView('home');
    });

    // Open folder button
    document.getElementById('open-folder-btn').addEventListener('click', () => {
        window.api.openOutputFolder();
    });

    // Open logs button
    document.getElementById('open-logs-btn').addEventListener('click', () => {
        window.api.openLogsFolder();
    });

    // Toggle issues button
    document.getElementById('toggle-issues-btn').addEventListener('click', () => {
        const content = document.getElementById('issue-log-content');
        const btn = document.getElementById('toggle-issues-btn');

        if (content.classList.contains('hidden')) {
            content.classList.remove('hidden');
            btn.textContent = 'Hide';
        } else {
            content.classList.add('hidden');
            btn.textContent = 'Show';
        }
    });

    // Launch Chrome button
    document.getElementById('launch-chrome-btn').addEventListener('click', async () => {
        document.getElementById('launch-chrome-btn').disabled = true;
        document.getElementById('launch-chrome-btn').textContent = 'Launching...';

        await window.api.launchChrome();
        showStep('login');
    });

    // Ready to scrape button
    document.getElementById('ready-btn').addEventListener('click', async () => {
        const url = document.getElementById('leads-url').value.trim();
        const listName = document.getElementById('list-name').value.trim() || 'LinkedIn Leads';

        showStep('progress');
        document.getElementById('progress-text').textContent = 'Connecting to browser...';
        document.getElementById('progress-fill').style.width = '0%';
        document.getElementById('progress-count').textContent = '0 leads';
        document.getElementById('progress-speed').textContent = '⚡ -- leads/min';
        document.getElementById('progress-current').textContent = '';
        document.getElementById('stop-btn').disabled = false;
        document.getElementById('stop-btn').textContent = '⏹ Stop & Save';
        lastScrapeStats = null;

        // Reset issue log
        currentIssues = [];
        document.getElementById('issue-log').classList.add('hidden');
        document.getElementById('issue-log-content').innerHTML = '';
        document.getElementById('issue-log-content').classList.add('hidden');
        document.getElementById('progress-skipped').classList.add('hidden');

        const result = await window.api.startScraping({
            url: url || null,
            listName: listName,
            maxLeads: currentSettings.maxLeadsPerScrape || 200
        });

        handleScrapingResult(result);
    });

    // Stop button
    document.getElementById('stop-btn').addEventListener('click', async () => {
        document.getElementById('stop-btn').disabled = true;
        document.getElementById('stop-btn').textContent = 'Stopping...';
        document.getElementById('progress-text').textContent = 'Stopping and saving...';

        await window.api.stopScraping();
    });

    // Open file button
    document.getElementById('open-file-btn').addEventListener('click', () => {
        if (currentFilepath) {
            window.api.openFile(currentFilepath);
        }
    });

    // Open partial file button
    document.getElementById('open-partial-btn').addEventListener('click', () => {
        if (currentFilepath) {
            window.api.openFile(currentFilepath);
        }
    });

    // Done button
    document.getElementById('done-btn').addEventListener('click', async () => {
        await loadHistory();
        await loadFiles();
        showView('home');
    });

    // Save to Drive button
    const saveToDriveBtn = document.getElementById('save-to-drive-btn');
    if (saveToDriveBtn) {
        saveToDriveBtn.addEventListener('click', async () => {
            if (!currentFilepath) return;

            const section = document.getElementById('drive-upload-section');
            const textEl = document.getElementById('drive-upload-text');

            section.classList.add('uploading');
            saveToDriveBtn.disabled = true;
            saveToDriveBtn.innerHTML = '<span>⏳</span> Uploading...';
            textEl.textContent = 'Uploading to Google Drive...';

            try {
                const result = await window.api.driveUpload(currentFilepath);
                if (result.success) {
                    section.classList.remove('uploading');
                    section.classList.add('success');
                    textEl.textContent = '✓ Saved to Google Drive!';
                    saveToDriveBtn.innerHTML = '<span>✓</span> Saved';
                    showToast('File saved to Google Drive!');
                } else {
                    throw new Error(result.error);
                }
            } catch (err) {
                section.classList.remove('uploading');
                textEl.textContent = 'Upload failed: ' + err.message;
                saveToDriveBtn.disabled = false;
                saveToDriveBtn.innerHTML = '<span>📤</span> Retry';
                showToast('Upload failed: ' + err.message);
            }
        });
    }

    // Save to Drive button - Stopped step
    const saveToDriveBtnStopped = document.getElementById('save-to-drive-btn-stopped');
    if (saveToDriveBtnStopped) {
        saveToDriveBtnStopped.addEventListener('click', async () => {
            if (!currentFilepath) return;

            const section = document.getElementById('drive-upload-section-stopped');
            const textEl = document.getElementById('drive-upload-text-stopped');

            section.classList.add('uploading');
            saveToDriveBtnStopped.disabled = true;
            saveToDriveBtnStopped.innerHTML = '<span>⏳</span> Uploading...';
            textEl.textContent = 'Uploading to Google Drive...';

            try {
                const result = await window.api.driveUpload(currentFilepath);
                if (result.success) {
                    section.classList.remove('uploading');
                    section.classList.add('success');
                    textEl.textContent = '✓ Saved to Google Drive!';
                    saveToDriveBtnStopped.innerHTML = '<span>✓</span> Saved';
                    showToast('File saved to Google Drive!');
                } else {
                    throw new Error(result.error);
                }
            } catch (err) {
                section.classList.remove('uploading');
                textEl.textContent = 'Upload failed: ' + err.message;
                saveToDriveBtnStopped.disabled = false;
                saveToDriveBtnStopped.innerHTML = '<span>📤</span> Retry';
                showToast('Upload failed: ' + err.message);
            }
        });
    }

    // Home button
    document.getElementById('home-btn').addEventListener('click', async () => {
        await loadHistory();
        await loadFiles();
        showView('home');
    });

    // Restart button
    document.getElementById('restart-btn').addEventListener('click', () => {
        showStep('login');
    });

    // Retry button
    document.getElementById('retry-btn').addEventListener('click', () => {
        showStep('launch');
        document.getElementById('launch-chrome-btn').disabled = false;
        document.getElementById('launch-chrome-btn').textContent = 'Launch Chrome';
    });

    // View logs button
    document.getElementById('view-logs-btn').addEventListener('click', () => {
        window.api.openLogsFolder();
    });
}

// Handle scraping result
function handleScrapingResult(result) {
    if (result.success) {
        currentFilepath = result.filepath;

        if (result.stopped) {
            document.getElementById('stopped-text').textContent =
                `Saved ${result.count} leads (partial)`;
            showStep('stopped');
        } else {
            document.getElementById('complete-text').textContent =
                `Successfully scraped ${result.count} leads`;

            // Show speed stats if available
            if (lastScrapeStats) {
                document.getElementById('complete-stats').textContent =
                    `⚡ ${lastScrapeStats.leadsPerMinute} leads/min • ${Math.round(lastScrapeStats.totalTime)}s total`;
            }

            showStep('complete');

            // Show Drive upload option if connected
            showDriveUploadOption();
        }

        loadHistory();
        loadFiles();
    } else {
        document.getElementById('error-text').textContent = result.error;

        if (result.partialSave) {
            currentFilepath = result.filepath;
            document.getElementById('partial-save-text').textContent =
                `Partial results saved: ${result.count} leads`;
            document.getElementById('partial-save-text').classList.remove('hidden');
        } else {
            document.getElementById('partial-save-text').classList.add('hidden');
        }

        showStep('error');
    }

    document.getElementById('stop-btn').disabled = false;
    document.getElementById('stop-btn').textContent = '⏹ Stop & Save';
}

// Setup progress listener
function setupProgressListener() {
    window.api.onProgress((progress) => {
        const { current, total, name, page, speed, skipped } = progress;
        const percent = Math.round((current / total) * 100);

        document.getElementById('progress-fill').style.width = `${percent}%`;
        document.getElementById('progress-count').textContent = `${current} / ${total} leads`;
        document.getElementById('progress-current').textContent = name || '';
        document.getElementById('progress-text').textContent =
            page ? `Scraping page ${page}...` : 'Scraping leads...';

        // Update speed display
        if (speed) {
            document.getElementById('progress-speed').textContent = `⚡ ${speed} leads/min`;
        }

        // Update skipped count
        if (skipped > 0) {
            const skipBadge = document.getElementById('progress-skipped');
            skipBadge.textContent = `⚠️ ${skipped} skipped`;
            skipBadge.classList.remove('hidden');
        }
    });
}

// Setup stats listener
function setupStatsListener() {
    window.api.onStats((stats) => {
        lastScrapeStats = stats;
    });
}

// Setup issue listener
function setupIssueListener() {
    window.api.onIssue((issue) => {
        currentIssues.push(issue);

        // Show issue log
        const issueLog = document.getElementById('issue-log');
        const issueContent = document.getElementById('issue-log-content');

        issueLog.classList.remove('hidden');

        // Get icon based on type
        const icons = {
            error: '❌',
            warning: '⚠️',
            skip: '⏭️'
        };
        const icon = icons[issue.type] || '⚠️';

        // Add issue to log
        const issueEl = document.createElement('div');
        issueEl.className = `issue-item ${issue.type}`;
        issueEl.innerHTML = `
            <span class="issue-icon">${icon}</span>
            <span class="issue-text">${escapeHtml(issue.message)}</span>
        `;
        issueContent.appendChild(issueEl);

        // Auto-scroll to bottom
        issueContent.scrollTop = issueContent.scrollHeight;
    });
}

// Show view
function showView(viewName) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    views[viewName].classList.add('active');
}

// Show step
function showStep(stepName) {
    Object.values(steps).forEach(s => s.classList.add('hidden'));
    steps[stepName].classList.remove('hidden');
}

// Show toast notification
function showToast(message) {
    let toast = document.querySelector('.toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast';
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, 2000);
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Format date
function formatDate(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;

    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
}

// Format file size
function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Check Google Drive status
async function checkDriveStatus() {
    try {
        const status = await window.api.driveStatus();
        updateDriveStatus(status.connected, status.email);
    } catch {
        updateDriveStatus(false);
    }
}

// Show Drive upload option after scraping completes
async function showDriveUploadOption() {
    const section = document.getElementById('drive-upload-section');
    const btn = document.getElementById('save-to-drive-btn');
    const textEl = document.getElementById('drive-upload-text');

    if (!section) return;

    // Reset state
    section.classList.remove('hidden', 'success', 'uploading');
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span>📤</span> Save to Drive';
    }
    if (textEl) {
        textEl.textContent = 'Save to Google Drive?';
    }

    // Check if Drive is connected
    try {
        const status = await window.api.driveStatus();
        if (status.connected) {
            section.classList.remove('hidden');
        } else {
            section.classList.add('hidden');
        }
    } catch {
        section.classList.add('hidden');
    }
}

// Update Drive UI
function updateDriveStatus(connected, email = null) {
    const disconnectedEl = document.getElementById('drive-disconnected');
    const connectedEl = document.getElementById('drive-connected');
    const emailEl = document.getElementById('drive-email');
    const connectBtn = document.getElementById('drive-connect-btn');
    const disconnectBtn = document.getElementById('drive-disconnect-btn');

    if (!disconnectedEl || !connectedEl) return;

    if (connected) {
        disconnectedEl.classList.add('hidden');
        connectedEl.classList.remove('hidden');
        if (emailEl && email) emailEl.textContent = email;
        if (connectBtn) connectBtn.classList.add('hidden');
        if (disconnectBtn) disconnectBtn.classList.remove('hidden');
    } else {
        disconnectedEl.classList.remove('hidden');
        connectedEl.classList.add('hidden');
        if (connectBtn) {
            connectBtn.classList.remove('hidden');
            connectBtn.disabled = false;
            connectBtn.textContent = 'Connect Google Drive';
        }
        if (disconnectBtn) disconnectBtn.classList.add('hidden');
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);
