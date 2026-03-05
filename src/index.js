#!/usr/bin/env node

/**
 * LinkedIn Sales Navigator Lead Scraper - Main Entry Point
 * 
 * Usage:
 *   npm start                    # Full scrape with profile URLs
 *   npm start -- --quick         # Quick scrape (visible data only)
 *   npm start -- --max 10        # Limit to 10 leads
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { connectToBrowser, printLaunchInstructions } from './browser.js';
import { scrapeLeads, quickScrapeLeads } from './scraper.js';
import { log, exportToJson, exportToCsv, ensureOutputDir } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const OUTPUT_DIR = join(PROJECT_ROOT, 'output');

/**
 * Parse command line arguments
 */
function parseArgs() {
    const args = process.argv.slice(2);
    return {
        quick: args.includes('--quick') || args.includes('-q'),
        debug: args.includes('--debug') || args.includes('-d'),
        help: args.includes('--help') || args.includes('-h'),
        maxLeads: (() => {
            const maxIndex = args.indexOf('--max');
            if (maxIndex !== -1 && args[maxIndex + 1]) {
                return parseInt(args[maxIndex + 1], 10);
            }
            return 100;
        })()
    };
}

/**
 * Print usage information
 */
function printHelp() {
    console.log(`
LinkedIn Sales Navigator Lead Scraper
=====================================

Usage:
  npm start                     Full scrape with profile URLs (agentic navigation)
  npm start -- --quick          Quick scrape (visible data only, no clicking)
  npm start -- --max <number>   Limit number of leads to process
  npm start -- --help           Show this help message

Examples:
  npm start -- --max 5          Scrape only 5 leads
  npm start -- --quick --max 10 Quick scrape of 10 leads

Output:
  Results are saved to the 'output' folder as both JSON and CSV files.

Prerequisites:
  1. Launch Chrome with remote debugging enabled
  2. Log in to LinkedIn Sales Navigator
  3. Navigate to your Leads page
  4. Run this scraper

`);
    printLaunchInstructions();
}

/**
 * Main entry point
 */
async function main() {
    const options = parseArgs();

    if (options.help) {
        printHelp();
        process.exit(0);
    }

    console.log('\n' + '='.repeat(60));
    console.log('🔍 LinkedIn Sales Navigator Lead Scraper');
    console.log('='.repeat(60) + '\n');

    log(`Mode: ${options.quick ? 'Quick scrape' : 'Full scrape with profile URLs'}`, 'info');
    log(`Max leads: ${options.maxLeads}`, 'info');

    let browser = null;

    try {
        // Connect to the running Chrome browser
        const connection = await connectToBrowser();
        browser = connection.browser;
        const page = connection.page;

        // Check if we're on Sales Navigator
        const currentUrl = page.url();
        if (!currentUrl.includes('linkedin.com/sales')) {
            log('Warning: Current page does not appear to be LinkedIn Sales Navigator', 'warning');
            log(`Current URL: ${currentUrl}`, 'info');
        }

        // Ensure output directory exists
        await ensureOutputDir(OUTPUT_DIR);

        // Perform the scrape
        let leads;
        if (options.quick) {
            leads = await quickScrapeLeads(page);
        } else {
            leads = await scrapeLeads(page, { maxLeads: options.maxLeads });
        }

        // Export results
        if (leads.length > 0) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const jsonPath = join(OUTPUT_DIR, `leads_${timestamp}.json`);
            const csvPath = join(OUTPUT_DIR, `leads_${timestamp}.csv`);

            await exportToJson(leads, jsonPath);
            await exportToCsv(leads, csvPath);

            console.log('\n' + '='.repeat(60));
            console.log('📊 SCRAPING RESULTS');
            console.log('='.repeat(60));
            console.log(`\nTotal leads scraped: ${leads.length}`);
            console.log(`\nOutput files:`);
            console.log(`  📄 JSON: ${jsonPath}`);
            console.log(`  📄 CSV:  ${csvPath}`);
            console.log('\n' + '='.repeat(60) + '\n');
        } else {
            log('No leads were scraped', 'warning');
        }

    } catch (error) {
        log(`Error: ${error.message}`, 'error');
        if (options.debug) {
            console.error(error);
        }
        process.exit(1);
    } finally {
        // Note: We don't close the browser since it's the user's session
        if (browser) {
            log('Scraping complete. Your browser session remains open.', 'success');
        }
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\nReceived SIGINT. Shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n\nReceived SIGTERM. Shutting down gracefully...');
    process.exit(0);
});

// Run the scraper
main();
