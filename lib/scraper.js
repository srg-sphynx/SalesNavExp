/**
 * LinkedIn Sales Navigator Lead Scraper
 * Logic ported from src/scraper.js (Verified Selectors Jan 2026)
 * Adapted for V3 Electron IPC architecture
 */

// Utility functions (embedded to ensure stability in build)
const randomDelay = (min = 1000, max = 3000) => Math.floor(Math.random() * (max - min + 1)) + min;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const humanDelay = async (baseMs = 2000, variance = 0.5) => {
    const min = baseMs * (1 - variance);
    const max = baseMs * (1 + variance);
    const delay = randomDelay(min, max);
    await sleep(delay);
};

// Verified Selectors for Sales Navigator (January 2026)
const SELECTORS = {
    // Lead list - links to individual leads
    leadNameLink: 'a.lists-detail__view-profile-name-link',
    // Sidesheet containers
    sidesheet: '.artdeco-entity-right-rail, .lead-lists-sidesheet__container, [id*="lead-details"]',
    // More actions menu button (the "..." button in sidesheet)
    moreActionsButton: 'button[aria-label="Open actions overflow menu"]',
    // Company link
    companyLink: 'a[href*="/sales/company/"]',
    // Location
    locationElement: '[data-anonymize="location"]',
    // Close button for sidesheet
    closeButton: '.artdeco-button--circle.artdeco-button--tertiary, button[aria-label="Close"]',
};

/**
 * Wait for page load with fallback
 */
async function waitForPageLoad(page, timeout = 10000) {
    try {
        await page.waitForLoadState('networkidle', { timeout });
    } catch {
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 });
    }
}

/**
 * Extract all lead names/links from the current page
 */
async function extractLeadsFromList(page) {
    await waitForPageLoad(page);
    await humanDelay(1500);

    const leads = await page.evaluate(() => {
        const results = [];
        // Original verified selector
        const nameLinks = document.querySelectorAll('a.lists-detail__view-profile-name-link');

        nameLinks.forEach((link, index) => {
            if (!link.innerText.trim() || link.offsetParent === null) return;

            results.push({
                index,
                name: link.innerText.trim(),
                salesNavLink: link.href,
                title: '',
                company: '',
                location: '',
                profileUrl: ''
            });
        });

        return results;
    });

    return leads;
}

/**
 * Click on a lead to open their profile sidesheet
 */
async function openLeadSidesheet(page, leadIndex) {
    const clicked = await page.evaluate((index) => {
        const links = document.querySelectorAll('a.lists-detail__view-profile-name-link');
        const visibleLinks = Array.from(links).filter(link => link.innerText.trim() && link.offsetParent !== null);

        if (visibleLinks[index]) {
            visibleLinks[index].click();
            return true;
        }
        return false;
    }, leadIndex);

    if (!clicked) {
        throw new Error(`Could not click on lead at index ${leadIndex}`);
    }

    // Wait for sidesheet to appear
    await humanDelay(1200);
}

/**
 * Extract data from the open sidesheet: company, location, and profile URL
 */
async function extractFromSidesheet(page) {
    // First, get company and location from the sidesheet
    const basicData = await page.evaluate(() => {
        const sidesheet = document.querySelector('.artdeco-entity-right-rail, .lead-lists-sidesheet__container, [id*="lead-details"]');
        if (!sidesheet) return { company: '', location: '', title: '' };

        // Extract company
        const companyEl = sidesheet.querySelector('a[href*="/sales/company/"]');
        const company = companyEl ? companyEl.innerText.trim() : '';

        // Extract location
        let location = '';
        const locEl = sidesheet.querySelector('[data-anonymize="location"]');
        if (locEl) {
            location = locEl.innerText.trim();
        } else {
            const locIcon = sidesheet.querySelector('li-icon[type="location-marker-icon"]');
            if (locIcon && locIcon.parentElement) {
                location = locIcon.parentElement.innerText.trim();
            }
        }

        // Extract title
        let title = '';
        const titleEl = sidesheet.querySelector('[data-anonymize="title"]');
        if (titleEl) {
            title = titleEl.innerText.trim();
        }

        return { company, location, title };
    });

    // Now click the "More actions" menu to get the profile URL
    let profileUrl = '';

    try {
        const menuClicked = await page.evaluate(() => {
            const moreBtn = document.querySelector('button[aria-label="Open actions overflow menu"]');
            if (moreBtn) {
                moreBtn.click();
                return true;
            }
            return false;
        });

        if (menuClicked) {
            await humanDelay(500);

            profileUrl = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a'));
                const profileLink = links.find(a =>
                    a.innerText.includes('View LinkedIn profile') ||
                    a.href?.includes('linkedin.com/in/')
                );
                return profileLink ? profileLink.href : '';
            });

            await page.keyboard.press('Escape');
            await humanDelay(300);
        }
    } catch (e) {
        // Log but continue
    }

    return {
        company: basicData.company,
        location: basicData.location,
        title: basicData.title,
        profileUrl
    };
}

/**
 * Close the sidesheet
 */
async function closeSidesheet(page) {
    await page.keyboard.press('Escape');
    await humanDelay(500);
}

/**
 * Navigate to the next page of leads
 */
async function goToNextPage(page) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await humanDelay(500);

    const clicked = await page.evaluate(() => {
        let nextBtn = document.querySelector('button._next-btn_15whdx');
        if (!nextBtn) nextBtn = document.querySelector('button[aria-label="Next"]');
        if (!nextBtn) {
            const buttons = Array.from(document.querySelectorAll('button'));
            nextBtn = buttons.find(b => b.innerText.trim() === 'Next' && !b.disabled);
        }

        if (nextBtn && !nextBtn.disabled) {
            nextBtn.click();
            return true;
        }
        return false;
    });

    if (clicked) {
        await waitForPageLoad(page);
        await humanDelay(1800);
        await page.evaluate(() => window.scrollTo(0, 0));
        return true;
    }

    return false;
}

/**
 * Main scraping function - processes all leads with pagination
 * Adapted for V3 (accepts options with callbacks)
 */
async function scrapeLeadsWithProgress(page, options = {}) {
    const {
        maxLeads = 200,
        onProgress,
        shouldStop = () => false,
        onLeadScraped = () => { },
        onStats = () => { },
        onIssue = () => { }
    } = options;

    let allLeads = [];
    let pageNumber = 1;
    const startTime = Date.now();
    let skippedCount = 0;
    let issueCount = 0;

    // Report initial status
    if (onProgress) onProgress({ phase: 'starting' });

    try {
        while (allLeads.length < maxLeads) {
            if (shouldStop()) break;

            // Ensure no sidesheet is open
            try { await page.keyboard.press('Escape'); } catch { }
            await humanDelay(500);

            // Extract leads from list
            const leads = await extractLeadsFromList(page);

            if (leads.length === 0) {
                onIssue({ type: 'warning', message: 'No leads found on this page' });
                break;
            }

            // Process leads
            for (let i = 0; i < leads.length && allLeads.length < maxLeads; i++) {
                if (shouldStop()) break;

                const lead = leads[i];
                const current = allLeads.length + 1;

                // Calculate speed
                const elapsedMinutes = (Date.now() - startTime) / 60000;
                const leadsPerMinute = elapsedMinutes > 0 ? (allLeads.length / elapsedMinutes) : 0;

                // Report progress BEFORE processing (showing what we are working on)
                if (onProgress) {
                    onProgress({
                        phase: 'scraping',
                        current,
                        maxLeads, // Use maxLeads instead of total for progress bar context
                        leadsScraped: allLeads.length,
                        name: lead.name,
                        page: pageNumber,
                        speed: leadsPerMinute,
                        skipped: skippedCount,
                        issues: issueCount
                    });
                }

                try {
                    await openLeadSidesheet(page, i);

                    if (shouldStop()) {
                        await closeSidesheet(page);
                        break;
                    }

                    const sidesheetData = await extractFromSidesheet(page);

                    // Consolidate data
                    const scrapedLead = {
                        name: lead.name,
                        title: sidesheetData.title || lead.title,
                        company: sidesheetData.company || lead.company,
                        location: sidesheetData.location || lead.location,
                        profileUrl: sidesheetData.profileUrl,
                        salesNavLink: lead.salesNavLink
                    };

                    allLeads.push(scrapedLead);
                    onLeadScraped(scrapedLead);

                    await closeSidesheet(page);

                } catch (error) {
                    issueCount++;
                    skippedCount++;
                    onIssue({ type: 'error', message: `Error on ${lead.name}: ${error.message}` });
                    try { await page.keyboard.press('Escape'); } catch { }
                }

                await humanDelay(1500, 0.3);
            }

            if (shouldStop() || allLeads.length >= maxLeads) break;

            const hasNext = await goToNextPage(page);
            if (!hasNext) {
                onIssue({ type: 'info', message: 'No more pages available' });
                break;
            }
            pageNumber++;
        }
    } catch (error) {
        onIssue({ type: 'fatal', message: error.message });
        throw error;
    }

    // Final stats
    const totalTime = (Date.now() - startTime) / 1000;
    const finalStats = {
        totalLeads: allLeads.length,
        totalTime,
        leadsPerMinute: Math.round((allLeads.length / (totalTime / 60)) * 10) / 10,
        skipped: skippedCount,
        issues: issueCount
    };

    onStats(finalStats);
    // Completion event handled by main.js after saving
    // if (onProgress) onProgress({ phase: 'complete', ...finalStats }); 

    return allLeads;
}

module.exports = { scrapeLeadsWithProgress };
