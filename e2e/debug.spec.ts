import { test, expect } from '@playwright/test';
import { waitForAppReady, injectTauriMock } from './helpers';

/**
 * Debug test to check what's rendered
 */
test('debug - check page content', async ({ page }) => {
  // Collect console messages
  const consoleMessages: string[] = [];
  page.on('console', (msg) => {
    consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
  });

  // Collect page errors
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  // IMPORTANT: Inject mock BEFORE navigating
  await injectTauriMock(page);

  await page.goto('/');
  await waitForAppReady(page);

  // Log page title
  const title = await page.title();
  console.log('Page title:', title);

  // Log body HTML
  const bodyHTML = await page.locator('body').innerHTML();
  console.log('Body HTML (first 500 chars):', bodyHTML.substring(0, 500));

  // Check if __TAURI__ is defined
  const hasTauri = await page.evaluate(() => {
    return typeof (window as any).__TAURI__ !== 'undefined';
  });
  console.log('Has __TAURI__:', hasTauri);

  // Check for React root
  const hasReactRoot = await page.locator('#root').count();
  console.log('Has #root:', hasReactRoot > 0);

  // Check for any visible text
  const bodyText = await page.locator('body').textContent();
  console.log('Body text (first 200 chars):', bodyText?.substring(0, 200));

  // Log console messages
  console.log('\n=== Console Messages ===');
  consoleMessages.forEach((msg) => console.log(msg));

  // Log page errors
  console.log('\n=== Page Errors ===');
  if (pageErrors.length > 0) {
    pageErrors.forEach((err) => console.log(err));
  } else {
    console.log('No errors');
  }

  // Take screenshot for manual inspection
  await page.screenshot({ path: 'debug-screenshot.png', fullPage: true });
  console.log('\nScreenshot saved to debug-screenshot.png');
});
