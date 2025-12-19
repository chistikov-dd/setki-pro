import { Page } from '@playwright/test';

/**
 * Helper functions for testing Tauri app through WebView
 */

/**
 * Wait for Tauri to be ready
 */
export async function waitForTauri(page: Page) {
  await page.waitForFunction(() => {
    return window.__TAURI__ !== undefined;
  }, { timeout: 10000 });
}

/**
 * Mock Tauri invoke command
 * This allows us to intercept Tauri commands and return mock data
 */
export async function mockTauriCommand(
  page: Page,
  command: string,
  response: unknown
) {
  await page.evaluate(
    ({ cmd, res }) => {
      const originalInvoke = window.__TAURI__.invoke;
      window.__TAURI__.invoke = async (commandName: string, args?: unknown) => {
        if (commandName === cmd) {
          return Promise.resolve(res);
        }
        return originalInvoke(commandName, args);
      };
    },
    { cmd: command, res: response }
  );
}

/**
 * Get value from localStorage
 */
export async function getLocalStorage(page: Page, key: string): Promise<string | null> {
  return await page.evaluate((k) => localStorage.getItem(k), key);
}

/**
 * Set value in localStorage
 */
export async function setLocalStorage(page: Page, key: string, value: string) {
  await page.evaluate(
    ({ k, v }) => localStorage.setItem(k, v),
    { k: key, v: value }
  );
}

/**
 * Clear localStorage
 */
export async function clearLocalStorage(page: Page) {
  await page.evaluate(() => localStorage.clear());
}

/**
 * Wait for element by test ID
 */
export async function waitForTestId(page: Page, testId: string, timeout = 5000) {
  await page.waitForSelector(`[data-testid="${testId}"]`, { timeout });
}

/**
 * Click element by test ID
 */
export async function clickTestId(page: Page, testId: string) {
  await page.click(`[data-testid="${testId}"]`);
}

/**
 * Type into input by test ID
 */
export async function typeIntoTestId(page: Page, testId: string, text: string) {
  await page.fill(`[data-testid="${testId}"]`, text);
}

/**
 * Get text content by test ID
 */
export async function getTextByTestId(page: Page, testId: string): Promise<string> {
  const element = await page.waitForSelector(`[data-testid="${testId}"]`);
  return (await element.textContent()) || '';
}

/**
 * Wait for navigation and Tauri to be ready
 */
export async function waitForNavigation(page: Page) {
  await page.waitForLoadState('networkidle');
  await waitForTauri(page);
}
