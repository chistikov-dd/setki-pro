import { test, expect } from '@playwright/test';
import {
  setupApp,
  setupOfflineMocks,
  setupJudgeMocks,
} from './helpers/test-setup';
import { mockBrackets, mockMatches } from './fixtures/mock-data';

test.describe('Offline Mode', () => {
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
  });

  test('Judge can login with cached PIN when offline', async ({ page }) => {
    await setupOfflineMocks(page);

    // Navigate to judge login
    await page.goto('/');
    await page.click('text=Войти как судья');

    // Fill PIN and name (PIN should be checked against cached_pins table)
    await page.fill('input[placeholder*="PIN"]', '123456');
    await page.fill('input[placeholder*="имя"]', 'Offline Судья');

    // Submit
    await page.click('button:has-text("Войти")');

    // Should still work offline
    await page.waitForURL('**/judge', { timeout: 10000 });
    await expect(page.locator('text=Панель судьи')).toBeVisible();
  });

  test('Judge can view cached brackets when offline', async ({ page }) => {
    await setupOfflineMocks(page);
    await setupJudgeMocks(page);

    // Login as judge
    await page.goto('/');
    await page.click('text=Войти как судья');
    await page.fill('input[placeholder*="PIN"]', '123456');
    await page.fill('input[placeholder*="имя"]', 'Offline Судья');
    await page.click('button:has-text("Войти")');
    await page.waitForURL('**/judge', { timeout: 10000 });

    // Should display cached brackets
    const bracketCards = page.locator('[data-testid="bracket-card"]');
    const availableBrackets = mockBrackets.filter((b) => !b.is_occupied);
    await expect(bracketCards).toHaveCount(availableBrackets.length);

    // Data should come from SQLite cache, not API
    await expect(page.locator(`text=${mockBrackets[0].name}`)).toBeVisible();
  });

  test('Judge can conduct match offline with sync queue', async ({ page }) => {
    await setupOfflineMocks(page);
    await setupJudgeMocks(page);

    // Login and navigate to match
    await page.goto('/');
    await page.click('text=Войти как судья');
    await page.fill('input[placeholder*="PIN"]', '123456');
    await page.fill('input[placeholder*="имя"]', 'Offline Судья');
    await page.click('button:has-text("Войти")');
    await page.waitForURL('**/judge', { timeout: 10000 });

    // Select bracket
    await page.locator('[data-testid="bracket-card"]').first().click();
    await page.waitForURL(/.*bracket\/\d+/, { timeout: 10000 });

    // Start match
    await page.locator('[data-testid="match-card"]').first().click();
    await page.waitForURL(/.*match\/\d+/, { timeout: 10000 });

    // Add scores (should go to sync_queue)
    await page.keyboard.press('1'); // Blue +1
    await page.keyboard.press('2'); // Blue +2
    await page.keyboard.press('q'); // Red +1

    // Scores should update locally
    const blueScore = page.locator('[data-testid="blue-score"]');
    const redScore = page.locator('[data-testid="red-score"]');
    await expect(blueScore).toHaveText('3'); // 1 + 2
    await expect(redScore).toHaveText('1');

    // Changes should be saved to SQLite sync_queue (no network error shown)
    // UI should remain functional
    await expect(page.locator('[data-testid="match-screen"]')).toBeVisible();
  });

  test('Offline indicator shows when network unavailable', async ({ page }) => {
    await setupOfflineMocks(page);
    await setupJudgeMocks(page);

    // Login and navigate to match
    await page.goto('/');
    await page.click('text=Войти как судья');
    await page.fill('input[placeholder*="PIN"]', '123456');
    await page.fill('input[placeholder*="имя"]', 'Offline Судья');
    await page.click('button:has-text("Войти")');
    await page.waitForURL('**/judge', { timeout: 10000 });

    // Select bracket and match
    await page.locator('[data-testid="bracket-card"]').first().click();
    await page.waitForURL(/.*bracket\/\d+/, { timeout: 10000 });
    await page.locator('[data-testid="match-card"]').first().click();
    await page.waitForURL(/.*match\/\d+/, { timeout: 10000 });

    // Should show offline indicator (WifiOff icon)
    await expect(page.locator('[data-testid="websocket-status"]')).toBeVisible();

    // Icon should indicate offline state
    const statusIcon = page.locator('[data-testid="websocket-status"] svg');
    await expect(statusIcon).toHaveAttribute('class', /WifiOff/);
  });

  test('Changes sync when network restored', async ({ page }) => {
    await setupOfflineMocks(page);
    await setupJudgeMocks(page);

    // Login and navigate to match
    await page.goto('/');
    await page.click('text=Войти как судья');
    await page.fill('input[placeholder*="PIN"]', '123456');
    await page.fill('input[placeholder*="имя"]', 'Offline Судья');
    await page.click('button:has-text("Войти")');
    await page.waitForURL('**/judge', { timeout: 10000 });

    // Select bracket and match
    await page.locator('[data-testid="bracket-card"]').first().click();
    await page.waitForURL(/.*bracket\/\d+/, { timeout: 10000 });
    await page.locator('[data-testid="match-card"]').first().click();
    await page.waitForURL(/.*match\/\d+/, { timeout: 10000 });

    // Make changes while offline
    await page.keyboard.press('1');
    await page.keyboard.press('z');

    // Simulate network restoration
    await page.unroute('**/api/v1/**');

    // Mock successful sync
    await page.evaluate(() => {
      window.__TAURI__.invoke = async (cmd: string) => {
        if (cmd === 'sync_changes') {
          return { synced_count: 2, failed_count: 0 };
        }
        return {};
      };
    });

    // Wait for background sync to trigger (30 seconds interval)
    // For test, we can manually trigger it
    await page.evaluate(() => {
      // Trigger sync manually for test
      window.dispatchEvent(new Event('online'));
    });

    // Should show sync success toast
    await expect(page.locator('text=/Синхронизация завершена/')).toBeVisible({ timeout: 35000 });
  });

  test('Cached data persists across app restarts', async ({ page }) => {
    await setupOfflineMocks(page);
    await setupJudgeMocks(page);

    // First session: login and view brackets
    await page.goto('/');
    await page.click('text=Войти как судья');
    await page.fill('input[placeholder*="PIN"]', '123456');
    await page.fill('input[placeholder*="имя"]', 'Test Judge');
    await page.click('button:has-text("Войти")');
    await page.waitForURL('**/judge', { timeout: 10000 });

    // Verify brackets are visible
    await expect(page.locator(`text=${mockBrackets[0].name}`)).toBeVisible();

    // Logout
    await page.click('button:has-text("Выйти")');
    await page.waitForURL('/', { timeout: 5000 });

    // Second session: login again (simulating app restart)
    await page.click('text=Войти как судья');
    await page.fill('input[placeholder*="PIN"]', '123456');
    await page.fill('input[placeholder*="имя"]', 'Test Judge');
    await page.click('button:has-text("Войти")');
    await page.waitForURL('**/judge', { timeout: 10000 });

    // Cached data should still be available
    await expect(page.locator(`text=${mockBrackets[0].name}`)).toBeVisible();
  });

  test('Sync queue accumulates changes during offline period', async ({ page }) => {
    await setupOfflineMocks(page);
    await setupJudgeMocks(page);

    // Login and navigate to match
    await page.goto('/');
    await page.click('text=Войти как судья');
    await page.fill('input[placeholder*="PIN"]', '123456');
    await page.fill('input[placeholder*="имя"]', 'Offline Судья');
    await page.click('button:has-text("Войти")');
    await page.waitForURL('**/judge', { timeout: 10000 });

    // Select bracket and match
    await page.locator('[data-testid="bracket-card"]').first().click();
    await page.waitForURL(/.*bracket\/\d+/, { timeout: 10000 });
    await page.locator('[data-testid="match-card"]').first().click();
    await page.waitForURL(/.*match\/\d+/, { timeout: 10000 });

    // Make multiple changes (all should queue)
    await page.keyboard.press('1'); // Score +1
    await page.keyboard.press('2'); // Score +2
    await page.keyboard.press('z'); // Warning
    await page.keyboard.press('q'); // Red score +1

    // All changes should be saved locally
    const blueScore = page.locator('[data-testid="blue-score"]');
    await expect(blueScore).toHaveText('3');

    // No error messages should appear
    const errorToast = page.locator('[role="alert"].error');
    await expect(errorToast).not.toBeVisible();
  });

  test('Admin can work offline with downloaded data', async ({ page }) => {
    await setupOfflineMocks(page);

    // Mock admin auth offline (using cached token)
    await page.evaluate(() => {
      window.__TAURI__.invoke = async (cmd: string) => {
        if (cmd === 'login_admin') {
          return {
            access_token: 'cached-token',
            user_id: 1,
            role: 'admin',
            tournament_id: 100,
          };
        }
        if (cmd === 'get_tournaments') {
          // Return cached tournaments
          return [
            {
              id: 100,
              name: 'Cached Tournament',
              start_date: '2025-01-15',
              end_date: '2025-01-17',
              location: 'Moscow',
              status: 'active',
            },
          ];
        }
        return {};
      };
    });

    // Login as admin
    await page.goto('/');
    await page.click('text=Войти как администратор');
    await page.fill('input[type="text"]', 'admin');
    await page.fill('input[type="password"]', 'password');
    await page.click('button:has-text("Войти")');
    await page.waitForURL('**/admin', { timeout: 10000 });

    // Should show cached tournament data
    await expect(page.locator('text=Cached Tournament')).toBeVisible();
  });
});
