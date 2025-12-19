import { Page, expect } from '@playwright/test';
import { createTauriMock } from './tauri-mock';

/**
 * Helper functions for Tauri E2E tests
 */

/**
 * Inject Tauri mock into the page
 */
export async function injectTauriMock(page: Page) {
  await page.addInitScript(() => {
    // Mock Tauri Internals (required by @tauri-apps/api v2.x)
    (window as any).__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: {
          label: 'main',
          scaleFactor: 1.0,
        },
      },
      invoke: async (cmd: string, args?: any) => {
        console.log(`[TAURI INTERNALS] invoke(${cmd})`, args);

        const mockResponses: Record<string, any> = {
          login_admin: { id: 1, username: 'admin', role: 'admin', token: 'mock-token' },
          login_by_pin: { id: 2, tournament_id: 100, pin_code: '123456', user_id: 10 },
          get_tournaments: [{ id: 100, name: 'Тестовый турнир 2025', date: '2025-12-19' }],
          get_cached_brackets: [{ id: 1, name: 'Мужчины до 70 кг', tournament_id: 100 }],
        };

        await new Promise(r => setTimeout(r, 50));
        return mockResponses[cmd] || { success: true };
      },
      convertFileSrc: (filePath: string) => `http://localhost:1420/${filePath}`,
    };

    (window as any).__TAURI__ = {
      core: {
        invoke: async (cmd: string, args?: any) => {
          console.log(`[TAURI MOCK] invoke(${cmd})`, args);

          // Mock responses
          const mockResponses: Record<string, any> = {
            login_admin: { id: 1, username: 'admin', role: 'admin', token: 'mock-token' },
            login_by_pin: { id: 2, tournament_id: 100, pin_code: '123456', user_id: 10 },
            get_tournaments: [{ id: 100, name: 'Тестовый турнир 2025', date: '2025-12-19' }],
            get_cached_brackets: [{ id: 1, name: 'Мужчины до 70 кг', tournament_id: 100 }],
          };

          await new Promise(r => setTimeout(r, 100));
          return mockResponses[cmd] || { success: true };
        },
      },
      event: {
        listen: async (event: string, handler: (payload: any) => void) => {
          console.log(`[TAURI MOCK] listen(${event})`);
          return () => {};
        },
        emit: async (event: string, payload?: any) => {
          console.log(`[TAURI MOCK] emit(${event})`, payload);
        },
      },
      webviewWindow: {
        getCurrent: () => ({
          label: 'main',
          scaleFactor: async () => 1.0,
          innerPosition: async () => ({ x: 0, y: 0 }),
          outerPosition: async () => ({ x: 0, y: 0 }),
          innerSize: async () => ({ width: 1920, height: 1080 }),
          outerSize: async () => ({ width: 1920, height: 1080 }),
          isFullscreen: async () => false,
          isMinimized: async () => false,
          isMaximized: async () => false,
          isFocused: async () => true,
          isDecorated: async () => true,
          isResizable: async () => true,
          isMaximizable: async () => true,
          isMinimizable: async () => true,
          isClosable: async () => true,
          isVisible: async () => true,
          title: async () => 'SETKI Desktop',
          close: async () => {},
          minimize: async () => {},
          maximize: async () => {},
          show: async () => {},
          hide: async () => {},
        }),
      },
    };
  });
}

/**
 * Wait for the app to be fully loaded
 * Note: injectTauriMock must be called BEFORE navigating to the page
 */
export async function waitForAppReady(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('body', { state: 'visible' });

  // Wait a bit for React to hydrate
  await page.waitForTimeout(500);
}

/**
 * Login as admin
 */
export async function loginAsAdmin(
  page: Page,
  login: string = 'admin',
  password: string = 'password'
) {
  await page.goto('/');
  await waitForAppReady(page);

  // Click "Вход как администратор" button
  await page.click('text=Вход как администратор');

  // Fill login form
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', password);

  // Submit
  await page.click('button[type="submit"]');

  // Wait for dashboard
  await page.waitForURL('/admin/dashboard');
}

/**
 * Login as judge with PIN
 */
export async function loginAsJudge(
  page: Page,
  pin: string = '123456',
  judgeName: string = 'Тестовый Судья'
) {
  await page.goto('/');
  await waitForAppReady(page);

  // Click "Вход как судья" button
  await page.click('text=Вход как судья');

  // Fill PIN
  await page.fill('input[name="pin"]', pin);
  await page.fill('input[name="judgeName"]', judgeName);

  // Submit
  await page.click('button[type="submit"]');

  // Wait for judge dashboard
  await page.waitForURL('/judge/dashboard');
}

/**
 * Navigate to match screen
 */
export async function navigateToMatch(page: Page, bracketId: number) {
  // Assuming we're on judge dashboard
  await page.click(`[data-bracket-id="${bracketId}"]`);

  // Select first available match
  await page.click('[data-match-card]:first-child');

  // Wait for match screen
  await page.waitForURL(/\/judge\/match\/\d+/);
}

/**
 * Add score to participant
 */
export async function addScore(page: Page, participant: 'red' | 'blue', points: number) {
  const selector =
    participant === 'red' ? `[data-red-score-${points}]` : `[data-blue-score-${points}]`;
  await page.click(selector);
}

/**
 * Add warning to participant
 */
export async function addWarning(page: Page, participant: 'red' | 'blue') {
  const selector =
    participant === 'red' ? '[data-red-warning]' : '[data-blue-warning]';
  await page.click(selector);
}

/**
 * Start/pause timer
 */
export async function toggleTimer(page: Page) {
  await page.press('body', 'Space');
}

/**
 * Finish match
 */
export async function finishMatch(page: Page, winner: 'red' | 'blue' | 'draw') {
  await page.press('body', 'Enter');

  // Select winner in dialog
  if (winner === 'red') {
    await page.click('[data-winner="red"]');
  } else if (winner === 'blue') {
    await page.click('[data-winner="blue"]');
  } else {
    await page.click('[data-winner="draw"]');
  }

  // Confirm
  await page.click('button:has-text("Подтвердить")');
}

/**
 * Get current score
 */
export async function getScore(page: Page, participant: 'red' | 'blue'): Promise<number> {
  const selector = participant === 'red' ? '[data-red-score]' : '[data-blue-score]';
  const text = await page.textContent(selector);
  return parseInt(text || '0');
}

/**
 * Get current warnings count
 */
export async function getWarnings(page: Page, participant: 'red' | 'blue'): Promise<number> {
  const selector =
    participant === 'red' ? '[data-red-warnings]' : '[data-blue-warnings]';
  const elements = await page.locator(`${selector} [data-warning-active]`).count();
  return elements;
}

/**
 * Check if timer is running
 */
export async function isTimerRunning(page: Page): Promise<boolean> {
  const playButton = await page.locator('[data-timer-play]').isVisible();
  return !playButton; // If play button is visible, timer is not running
}

/**
 * Wait for toast notification
 */
export async function waitForToast(page: Page, message?: string) {
  if (message) {
    await expect(page.locator(`[role="alert"]:has-text("${message}")`)).toBeVisible();
  } else {
    await expect(page.locator('[role="alert"]')).toBeVisible();
  }
}

/**
 * Clear app state (logout)
 */
export async function clearAppState(page: Page) {
  await page.goto('/');

  // Try to logout if logged in
  const logoutButton = page.locator('button:has-text("Выход")');
  if (await logoutButton.isVisible()) {
    await logoutButton.click();
  }
}
