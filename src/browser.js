/**
 * Browser connection and management module
 * Connects to an existing Chrome browser with remote debugging enabled
 */

import { chromium } from 'playwright';
import { log } from './utils.js';

const REMOTE_DEBUGGING_PORT = 9222;

/**
 * Instructions for launching Chrome with remote debugging
 */
export function printLaunchInstructions() {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 SETUP INSTRUCTIONS');
    console.log('='.repeat(60));
    console.log(`
Before running the scraper, you need to launch Chrome with remote debugging:

1. CLOSE all existing Chrome windows completely

2. Run this command in Terminal:
   
   /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome \\
     --remote-debugging-port=${REMOTE_DEBUGGING_PORT} \\
     --user-data-dir="$HOME/chrome-debug-profile"

3. In the Chrome window that opens:
   - Log in to LinkedIn Sales Navigator
   - Navigate to your Leads page
   - Make sure leads are visible on the page

4. Come back here and run the scraper again with:
   npm start

`);
    console.log('='.repeat(60) + '\n');
}

/**
 * Connect to an existing Chrome browser with remote debugging
 */
export async function connectToBrowser() {
    try {
        log('Connecting to Chrome browser...', 'progress');

        const browser = await chromium.connectOverCDP(`http://localhost:${REMOTE_DEBUGGING_PORT}`);

        log('Successfully connected to Chrome!', 'success');

        // Get the default context (the one with your logged-in session)
        const contexts = browser.contexts();
        if (contexts.length === 0) {
            throw new Error('No browser contexts found. Make sure Chrome is open with a page loaded.');
        }

        const context = contexts[0];
        const pages = context.pages();

        if (pages.length === 0) {
            throw new Error('No pages found in browser. Please open LinkedIn Sales Navigator.');
        }

        // Find the Sales Navigator page or use the first page
        let page = pages.find(p => p.url().includes('linkedin.com/sales'));

        if (!page) {
            log('No Sales Navigator page found. Using the current active page.', 'warning');
            page = pages[0];
        } else {
            log(`Found Sales Navigator page: ${page.url()}`, 'success');
        }

        return { browser, context, page };

    } catch (error) {
        if (error.message.includes('ECONNREFUSED') || error.message.includes('connect')) {
            log('Could not connect to Chrome. Make sure Chrome is running with remote debugging enabled.', 'error');
            printLaunchInstructions();
            throw new Error('Chrome not running with remote debugging');
        }
        throw error;
    }
}

/**
 * Gracefully close browser connection
 */
export async function disconnectBrowser(browser) {
    if (browser) {
        log('Disconnecting from browser...', 'progress');
        await browser.close();
        log('Disconnected from browser', 'success');
    }
}
