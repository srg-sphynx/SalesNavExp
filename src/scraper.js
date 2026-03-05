/**
 * LinkedIn Sales Navigator Lead Scraper
 * Extracts lead data including profile URLs through agentic navigation
 * Updated with verified selectors from January 2026 Sales Navigator UI
 */

import { log, humanDelay, sleep } from './utils.js';

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
export async function extractLeadsFromList(page) {
    log('Extracting leads from list...', 'progress');

    await waitForPageLoad(page);
    await humanDelay(1500);

    const leads = await page.evaluate(() => {
        const results = [];
        const nameLinks = document.querySelectorAll('a.lists-detail__view-profile-name-link');

        nameLinks.forEach((link, index) => {
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

    log(`Found ${leads.length} leads on the page`, 'success');
    return leads;
}

/**
 * Click on a lead to open their profile sidesheet
 */
async function openLeadSidesheet(page, leadIndex) {
    log(`Opening sidesheet for lead ${leadIndex + 1}...`, 'progress');

    const clicked = await page.evaluate((index) => {
        const links = document.querySelectorAll('a.lists-detail__view-profile-name-link');
        if (links[index]) {
            links[index].click();
            return true;
        }
        return false;
    }, leadIndex);

    if (!clicked) {
        throw new Error(`Could not click on lead at index ${leadIndex}`);
    }

    // Wait for sidesheet to appear
    await humanDelay(2000);
}

/**
 * Extract data from the open sidesheet: company, location, and profile URL
 */
async function extractFromSidesheet(page) {
    // First, get company and location from the sidesheet
    const basicData = await page.evaluate(() => {
        const sidesheet = document.querySelector('.artdeco-entity-right-rail, .lead-lists-sidesheet__container, [id*="lead-details"]');
        if (!sidesheet) return { company: '', location: '' };

        // Extract company
        const companyEl = sidesheet.querySelector('a[href*="/sales/company/"]');
        const company = companyEl ? companyEl.innerText.trim() : '';

        // Extract location - look for location marker icon or data-anonymize
        let location = '';
        const locEl = sidesheet.querySelector('[data-anonymize="location"]');
        if (locEl) {
            location = locEl.innerText.trim();
        } else {
            // Fallback: look for location icon parent
            const locIcon = sidesheet.querySelector('li-icon[type="location-marker-icon"]');
            if (locIcon && locIcon.parentElement) {
                location = locIcon.parentElement.innerText.trim();
            }
        }

        // Extract title from sidesheet
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
        // Click the "Open actions overflow menu" button
        const menuClicked = await page.evaluate(() => {
            const moreBtn = document.querySelector('button[aria-label="Open actions overflow menu"]');
            if (moreBtn) {
                moreBtn.click();
                return true;
            }
            return false;
        });

        if (menuClicked) {
            await humanDelay(800);

            // Find the "View LinkedIn profile" link and get its href
            profileUrl = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a'));
                const profileLink = links.find(a =>
                    a.innerText.includes('View LinkedIn profile') ||
                    a.href?.includes('linkedin.com/in/')
                );
                return profileLink ? profileLink.href : '';
            });

            // Close the menu by pressing Escape
            await page.keyboard.press('Escape');
            await humanDelay(300);
        }
    } catch (e) {
        log(`Error getting profile URL: ${e.message}`, 'warning');
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
    // Press Escape to close sidesheet
    await page.keyboard.press('Escape');
    await humanDelay(800);
}

/**
 * Navigate to the next page of leads
 */
async function goToNextPage(page) {
    log('Navigating to next page...', 'progress');

    // First scroll to bottom to ensure pagination is visible
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await humanDelay(500);

    const clicked = await page.evaluate(() => {
        // Try the specific Sales Navigator next button class
        let nextBtn = document.querySelector('button._next-btn_15whdx');

        // Fallback selectors
        if (!nextBtn) {
            nextBtn = document.querySelector('button[aria-label="Next"]');
        }
        if (!nextBtn) {
            // Look for any button with "Next" text in pagination area
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
        await humanDelay(2500);
        // Scroll back to top for next page
        await page.evaluate(() => window.scrollTo(0, 0));
        return true;
    }

    return false;
}

/**
 * Main scraping function - processes all leads with pagination
 */
export async function scrapeLeads(page, options = {}) {
    const { maxLeads = 150 } = options;

    log('Starting lead scraping process...', 'info');
    log(`Will scrape up to ${maxLeads} leads`, 'info');

    let allLeads = [];
    let pageNumber = 1;

    while (allLeads.length < maxLeads) {
        log(`\n=== Processing page ${pageNumber} ===`, 'info');

        // First, make sure no sidesheet is open
        await page.keyboard.press('Escape');
        await humanDelay(500);

        // Extract all lead names from the list
        const leads = await extractLeadsFromList(page);

        if (leads.length === 0) {
            log('No more leads found on this page', 'warning');
            break;
        }

        // Process each lead on this page
        for (let i = 0; i < leads.length && allLeads.length < maxLeads; i++) {
            const lead = leads[i];
            const totalProgress = allLeads.length + 1;
            log(`\n[${totalProgress}/${maxLeads}] Processing: ${lead.name}`, 'progress');

            try {
                // Open the lead's sidesheet
                await openLeadSidesheet(page, i);

                // Extract data from sidesheet (company, location, profile URL)
                const sidesheetData = await extractFromSidesheet(page);

                // Merge data
                lead.company = sidesheetData.company;
                lead.location = sidesheetData.location;
                lead.title = sidesheetData.title || lead.title;
                lead.profileUrl = sidesheetData.profileUrl;

                // Close the sidesheet
                await closeSidesheet(page);

                // Add to results (cleaned up object)
                allLeads.push({
                    name: lead.name,
                    title: lead.title,
                    company: lead.company,
                    location: lead.location,
                    profileUrl: lead.profileUrl,
                    salesNavLink: lead.salesNavLink
                });

                log(`✓ ${lead.name} | ${lead.company} | ${lead.profileUrl || 'no URL'}`, 'success');

            } catch (error) {
                log(`Error processing ${lead.name}: ${error.message}`, 'error');

                // Try to recover
                try {
                    await page.keyboard.press('Escape');
                    await humanDelay(1000);
                } catch { }
            }

            // Human-like delay between leads (2-4 seconds)
            await humanDelay(2500, 0.4);
        }

        // Check if we have enough leads
        if (allLeads.length >= maxLeads) {
            break;
        }

        // Try to go to next page
        const hasNextPage = await goToNextPage(page);
        if (!hasNextPage) {
            log('No more pages available', 'info');
            break;
        }

        pageNumber++;
    }

    log(`\n${'='.repeat(50)}`, 'info');
    log(`Completed! Scraped ${allLeads.length} leads across ${pageNumber} page(s)`, 'success');
    log(`${'='.repeat(50)}`, 'info');

    return allLeads;
}

/**
 * Quick scrape - only extracts visible data without clicking through
 */
export async function quickScrapeLeads(page) {
    log('Performing quick scrape (names only)...', 'info');
    return await extractLeadsFromList(page);
}
