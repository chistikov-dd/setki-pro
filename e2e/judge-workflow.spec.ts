import { test, expect } from '@playwright/test';
import {
  setupApp,
  setupJudgeMocks,
  loginAsJudge,
} from './helpers/test-setup';
import { mockBrackets, mockMatches } from './fixtures/mock-data';

test.describe('Judge Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
    await setupJudgeMocks(page);
  });

  test('Judge login with valid PIN and name', async ({ page }) => {
    await page.goto('/');

    // Should show login choice screen
    await expect(page.locator('text=Добро пожаловать в SETKI.PRO KEEPER')).toBeVisible();

    // Click judge login button
    await page.click('text=Войти как судья');

    // Should navigate to judge login page
    await expect(page).toHaveURL(/.*judge-login/);

    // Fill PIN and name
    await page.fill('input[placeholder*="PIN"]', '123456');
    await page.fill('input[placeholder*="имя"]', 'Тестовый Судья');

    // Submit form
    await page.click('button:has-text("Войти")');

    // Should redirect to judge dashboard
    await page.waitForURL('**/judge', { timeout: 10000 });
    await expect(page.locator('text=Панель судьи')).toBeVisible();
  });

  test('Judge can view available brackets', async ({ page }) => {
    await loginAsJudge(page);

    // Should show bracket selection
    await expect(page.locator('text=Выберите сетку')).toBeVisible();

    // Should display bracket cards
    const bracketCards = page.locator('[data-testid="bracket-card"]');
    const availableBrackets = mockBrackets.filter((b) => !b.is_occupied);
    await expect(bracketCards).toHaveCount(availableBrackets.length);

    // First bracket should be visible
    const firstBracket = mockBrackets.find((b) => !b.is_occupied);
    if (firstBracket) {
      await expect(page.locator(`text=${firstBracket.name}`)).toBeVisible();
      await expect(page.locator(`text=${firstBracket.weight_category} кг`)).toBeVisible();
    }
  });

  test('Judge cannot select occupied bracket', async ({ page }) => {
    await loginAsJudge(page);

    // Find occupied bracket
    const occupiedBracket = mockBrackets.find((b) => b.is_occupied);
    if (occupiedBracket) {
      const occupiedCard = page.locator(`text=${occupiedBracket.name}`).locator('..');

      // Should show occupied status
      await expect(occupiedCard.locator('text=Занято')).toBeVisible();

      // Button should be disabled
      const selectButton = occupiedCard.locator('button');
      await expect(selectButton).toBeDisabled();
    }
  });

  test('Judge can reserve and select bracket', async ({ page }) => {
    await loginAsJudge(page);

    // Click first available bracket
    const firstBracketCard = page.locator('[data-testid="bracket-card"]').first();
    const selectButton = firstBracketCard.locator('button:has-text("Выбрать")');
    await selectButton.click();

    // Should navigate to bracket view
    await page.waitForURL(/.*bracket\/\d+/, { timeout: 10000 });

    // Should show bracket visualization
    await expect(page.locator('[data-testid="tournament-bracket"]')).toBeVisible();
  });

  test('Judge can view tournament bracket with matches', async ({ page }) => {
    await loginAsJudge(page);

    // Select first bracket
    await page.locator('[data-testid="bracket-card"]').first().click();

    // Should display match cards
    const matchCards = page.locator('[data-testid="match-card"]');
    await expect(matchCards.count()).toBeGreaterThan(0);

    // Check match info
    const firstMatch = mockMatches[0];
    await expect(page.locator(`text=${firstMatch.red_participant.full_name.split(' ').slice(0, 2).join(' ')}`)).toBeVisible();
    await expect(page.locator(`text=${firstMatch.blue_participant.full_name.split(' ').slice(0, 2).join(' ')}`)).toBeVisible();
  });

  test('Judge can start a match', async ({ page }) => {
    await loginAsJudge(page);

    // Select bracket and navigate to it
    await page.locator('[data-testid="bracket-card"]').first().click();
    await page.waitForURL(/.*bracket\/\d+/, { timeout: 10000 });

    // Click on first pending match
    const firstMatchCard = page.locator('[data-testid="match-card"]').first();
    await firstMatchCard.click();

    // Should navigate to match screen
    await page.waitForURL(/.*match\/\d+/, { timeout: 10000 });

    // Should show match screen UI
    await expect(page.locator('[data-testid="match-screen"]')).toBeVisible();

    // Participants should be displayed
    await expect(page.locator('[data-testid="blue-participant"]')).toBeVisible();
    await expect(page.locator('[data-testid="red-participant"]')).toBeVisible();

    // Timer should be visible
    await expect(page.locator('[data-testid="match-timer"]')).toBeVisible();
  });

  test('Judge can add scores during match', async ({ page }) => {
    await loginAsJudge(page);

    // Navigate to match screen
    await page.locator('[data-testid="bracket-card"]').first().click();
    await page.waitForURL(/.*bracket\/\d+/, { timeout: 10000 });
    await page.locator('[data-testid="match-card"]').first().click();
    await page.waitForURL(/.*match\/\d+/, { timeout: 10000 });

    // Start timer
    await page.keyboard.press('Space');

    // Add score to blue fighter using keyboard
    await page.keyboard.press('1'); // 1 point to blue

    // Score should update
    const blueScore = page.locator('[data-testid="blue-score"]');
    await expect(blueScore).toHaveText('1');

    // Add score to red fighter
    await page.keyboard.press('q'); // 1 point to red (assuming Q key)

    const redScore = page.locator('[data-testid="red-score"]');
    await expect(redScore).toHaveText('1');
  });

  test('Judge can add warnings during match', async ({ page }) => {
    await loginAsJudge(page);

    // Navigate to match screen
    await page.locator('[data-testid="bracket-card"]').first().click();
    await page.waitForURL(/.*bracket\/\d+/, { timeout: 10000 });
    await page.locator('[data-testid="match-card"]').first().click();
    await page.waitForURL(/.*match\/\d+/, { timeout: 10000 });

    // Add warning to blue fighter
    await page.keyboard.press('z');

    // Warning should be visible
    const blueWarnings = page.locator('[data-testid="blue-warnings"]');
    await expect(blueWarnings.locator('.warning-dot-filled')).toHaveCount(1);

    // Add warning to red fighter
    await page.keyboard.press('x');

    const redWarnings = page.locator('[data-testid="red-warnings"]');
    await expect(redWarnings.locator('.warning-dot-filled')).toHaveCount(1);
  });

  test('Judge can undo last action with Ctrl+Z', async ({ page }) => {
    await loginAsJudge(page);

    // Navigate to match screen
    await page.locator('[data-testid="bracket-card"]').first().click();
    await page.waitForURL(/.*bracket\/\d+/, { timeout: 10000 });
    await page.locator('[data-testid="match-card"]').first().click();
    await page.waitForURL(/.*match\/\d+/, { timeout: 10000 });

    // Add score
    await page.keyboard.press('1');
    const blueScore = page.locator('[data-testid="blue-score"]');
    await expect(blueScore).toHaveText('1');

    // Undo
    await page.keyboard.press('Control+z');

    // Score should be back to 0
    await expect(blueScore).toHaveText('0');

    // Should show toast notification
    await expect(page.locator('text=/Действие отменено/')).toBeVisible({ timeout: 3000 });
  });

  test('Judge can control timer with Space key', async ({ page }) => {
    await loginAsJudge(page);

    // Navigate to match screen
    await page.locator('[data-testid="bracket-card"]').first().click();
    await page.waitForURL(/.*bracket\/\d+/, { timeout: 10000 });
    await page.locator('[data-testid="match-card"]').first().click();
    await page.waitForURL(/.*match\/\d+/, { timeout: 10000 });

    // Timer should be paused initially
    const timer = page.locator('[data-testid="match-timer"]');
    const initialTime = await timer.textContent();

    // Start timer
    await page.keyboard.press('Space');

    // Wait 2 seconds
    await page.waitForTimeout(2000);

    // Timer should have decreased
    const runningTime = await timer.textContent();
    expect(runningTime).not.toBe(initialTime);

    // Pause timer
    await page.keyboard.press('Space');

    // Wait 1 second
    await page.waitForTimeout(1000);

    // Timer should stay the same
    const pausedTime = await timer.textContent();
    await page.waitForTimeout(1000);
    const stillPausedTime = await timer.textContent();
    expect(stillPausedTime).toBe(pausedTime);
  });

  test('Judge can finish match and return to bracket', async ({ page }) => {
    await loginAsJudge(page);

    // Navigate to match screen
    await page.locator('[data-testid="bracket-card"]').first().click();
    await page.waitForURL(/.*bracket\/\d+/, { timeout: 10000 });
    await page.locator('[data-testid="match-card"]').first().click();
    await page.waitForURL(/.*match\/\d+/, { timeout: 10000 });

    // Add some scores
    await page.keyboard.press('1');
    await page.keyboard.press('2');

    // Finish match
    await page.keyboard.press('Enter');

    // Should show finish dialog
    await expect(page.locator('text=/Завершить поединок/')).toBeVisible();

    // Confirm finish by points
    await page.click('button:has-text("По очкам")');

    // Should return to bracket view
    await page.waitForURL(/.*bracket\/\d+/, { timeout: 10000 });
  });

  test('Judge can reset match with Ctrl+R', async ({ page }) => {
    await loginAsJudge(page);

    // Navigate to match screen
    await page.locator('[data-testid="bracket-card"]').first().click();
    await page.waitForURL(/.*bracket\/\d+/, { timeout: 10000 });
    await page.locator('[data-testid="match-card"]').first().click();
    await page.waitForURL(/.*match\/\d+/, { timeout: 10000 });

    // Add scores and warnings
    await page.keyboard.press('1');
    await page.keyboard.press('q');
    await page.keyboard.press('z');

    // Reset
    await page.keyboard.press('Control+r');

    // Should show confirmation dialog
    await expect(page.locator('text=/Сбросить всё/')).toBeVisible();

    // Confirm reset
    await page.click('button:has-text("Сбросить")');

    // All scores and warnings should be reset
    const blueScore = page.locator('[data-testid="blue-score"]');
    const redScore = page.locator('[data-testid="red-score"]');
    await expect(blueScore).toHaveText('0');
    await expect(redScore).toHaveText('0');
  });

  test('Judge can open help dialog with H key', async ({ page }) => {
    await loginAsJudge(page);

    // Navigate to match screen
    await page.locator('[data-testid="bracket-card"]').first().click();
    await page.waitForURL(/.*bracket\/\d+/, { timeout: 10000 });
    await page.locator('[data-testid="match-card"]').first().click();
    await page.waitForURL(/.*match\/\d+/, { timeout: 10000 });

    // Open help
    await page.keyboard.press('h');

    // Should show help dialog
    await expect(page.locator('text=/Горячие клавиши/')).toBeVisible();
    await expect(page.locator('text=/Space/')).toBeVisible();
    await expect(page.locator('text=/Ctrl\\+Z/')).toBeVisible();
  });

  test('Judge can logout and return to login screen', async ({ page }) => {
    await loginAsJudge(page);

    // Click logout button
    await page.click('button:has-text("Выйти")');

    // Should redirect to login choice
    await page.waitForURL('/', { timeout: 5000 });
    await expect(page.locator('text=Добро пожаловать в SETKI.PRO KEEPER')).toBeVisible();
  });
});
