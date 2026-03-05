/**
 * Utility functions for the LinkedIn Sales Navigator scraper
 */

/**
 * Generate a random delay between min and max milliseconds
 * Simulates human-like interaction patterns
 */
export function randomDelay(min = 1000, max = 3000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Human-like delay with random variance
 */
export async function humanDelay(baseMs = 2000, variance = 0.5) {
  const min = baseMs * (1 - variance);
  const max = baseMs * (1 + variance);
  const delay = randomDelay(min, max);
  await sleep(delay);
}

/**
 * Log with timestamp
 */
export function log(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = {
    info: '📌',
    success: '✅',
    error: '❌',
    warning: '⚠️',
    progress: '🔄'
  }[type] || '📌';
  
  console.log(`[${timestamp}] ${prefix} ${message}`);
}

/**
 * Export leads data to JSON file
 */
export async function exportToJson(leads, filepath) {
  const fs = await import('fs/promises');
  const data = JSON.stringify(leads, null, 2);
  await fs.writeFile(filepath, data, 'utf-8');
  log(`Exported ${leads.length} leads to ${filepath}`, 'success');
}

/**
 * Export leads data to CSV file
 */
export async function exportToCsv(leads, filepath) {
  const fs = await import('fs/promises');
  
  if (leads.length === 0) {
    log('No leads to export', 'warning');
    return;
  }
  
  const headers = Object.keys(leads[0]);
  const csvRows = [
    headers.join(','),
    ...leads.map(lead => 
      headers.map(header => {
        const value = lead[header] || '';
        // Escape commas and quotes in CSV
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',')
    )
  ];
  
  await fs.writeFile(filepath, csvRows.join('\n'), 'utf-8');
  log(`Exported ${leads.length} leads to ${filepath}`, 'success');
}

/**
 * Ensure output directory exists
 */
export async function ensureOutputDir(dirPath) {
  const fs = await import('fs/promises');
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}
