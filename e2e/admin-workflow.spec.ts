import { test, expect } from '@playwright/test';
import {
  setupApp,
  setupAdminMocks,
  loginAsAdmin,
  createSession,
  downloadTournament,
} from './helpers/test-setup';
import { mockTournaments } from './fixtures/mock-data';

test.describe('Admin Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
    await setupAdminMocks(page);
  });

  test('Admin login with valid credentials', async ({ page }) => {
    await page.goto('/');

    // Should show login choice screen
    await expect(page.locator('text=Добро пожаловать в SETKI.PRO KEEPER')).toBeVisible();

    // Click admin login button
    await page.click('text=Войти как администратор');

    // Should navigate to admin login page
    await expect(page).toHaveURL(/.*admin-login/);

    // Fill credentials
    await page.fill('input[type="text"]', 'admin');
    await page.fill('input[type="password"]', 'password123');

    // Submit form
    await page.click('button:has-text("Войти")');

    // Should redirect to admin dashboard
    await page.waitForURL('**/admin', { timeout: 10000 });
    await expect(page.locator('text=Панель администратора')).toBeVisible();
  });

  test('Admin can view tournament list', async ({ page }) => {
    await loginAsAdmin(page);

    // Should display tournaments
    await expect(page.locator('text=Доступные турниры')).toBeVisible();

    // Should show tournament cards
    const tournamentCards = page.locator('[data-testid="tournament-card"]');
    await expect(tournamentCards).toHaveCount(mockTournaments.length);

    // First tournament should be visible
    await expect(page.locator(`text=${mockTournaments[0].name}`)).toBeVisible();
    await expect(page.locator(`text=${mockTournaments[0].location}`)).toBeVisible();
  });

  test('Admin can download tournament data', async ({ page }) => {
    await loginAsAdmin(page);

    // Find and click download button for first tournament
    const firstTournamentCard = page.locator('[data-testid="tournament-card"]').first();
    const downloadButton = firstTournamentCard.locator('[data-testid="download-tournament-btn"]');

    await downloadButton.click();

    // Should show loading state
    await expect(downloadButton).toBeDisabled();

    // Wait for download to complete
    await page.waitForSelector('text=/Загружено/', { timeout: 15000 });

    // Should show success message
    await expect(page.locator('text=/успешно загружен/')).toBeVisible({ timeout: 5000 });
  });

  test('Admin can create session with PIN code', async ({ page }) => {
    await loginAsAdmin(page);

    // Download tournament first
    await downloadTournament(page);

    // Click create session button
    await page.click('button:has-text("Создать сессию")');

    // Should show session creation dialog or form
    // Select first tournament
    const firstTournament = page.locator('[data-testid="tournament-card"]').first();
    await firstTournament.click();

    // Wait for PIN code to be generated and displayed
    await page.waitForSelector('text=/PIN: \\d{6}/', { timeout: 10000 });

    // PIN should be 6 digits
    const pinText = await page.locator('text=/PIN: \\d{6}/').textContent();
    expect(pinText).toMatch(/PIN: \d{6}/);

    // Session info should be visible
    await expect(page.locator('text=Текущая сессия')).toBeVisible();
  });

  test('Admin can view judge tables monitor', async ({ page }) => {
    await loginAsAdmin(page);
    await createSession(page);

    // Should show judge tables section
    await expect(page.locator('text=Судейские столы')).toBeVisible();

    // Should display judge sessions
    const judgeSessions = page.locator('[data-testid="judge-session-row"]');
    await expect(judgeSessions.count()).toBeGreaterThan(0);

    // Check judge info is displayed
    await expect(page.locator('text=Иван Судейкин')).toBeVisible();
    await expect(page.locator('text=Мужчины -60 кг')).toBeVisible();
  });

  test('Admin can view active matches monitor', async ({ page }) => {
    await loginAsAdmin(page);
    await createSession(page);

    // Should show active matches section
    await expect(page.locator('text=Активные поединки')).toBeVisible();

    // Should display active match cards
    const activeMatches = page.locator('[data-testid="active-match-card"]');
    await expect(activeMatches.count()).toBeGreaterThan(0);

    // Check match info is displayed
    await expect(page.locator('text=Иванов Иван')).toBeVisible();
    await expect(page.locator('text=Петров Петр')).toBeVisible();

    // Check scores are displayed
    await expect(page.locator('text=/Счёт:/')).toBeVisible();
  });

  test('Admin can manually sync results', async ({ page }) => {
    await loginAsAdmin(page);
    await createSession(page);

    // Find sync button
    const syncButton = page.locator('button:has-text("Выгрузить результаты")');
    await syncButton.click();

    // Should show progress indicator
    await expect(page.locator('text=/Синхронизация/')).toBeVisible();

    // Wait for sync to complete
    await page.waitForSelector('text=/успешно/', { timeout: 10000 });

    // Should show success message
    await expect(page.locator('text=/Данные успешно синхронизированы/')).toBeVisible();
  });

  test('Admin can switch server modes', async ({ page }) => {
    await loginAsAdmin(page);

    // Find server mode selector
    const modeSelector = page.locator('[data-testid="server-mode-selector"]');
    await expect(modeSelector).toBeVisible();

    // Default should be Online
    await expect(page.locator('text=Режим: Online')).toBeVisible();

    // Switch to Local Server
    await page.click('button:has-text("Local Server")');

    // Should show local server mode
    await expect(page.locator('text=Режим: Local Server')).toBeVisible();

    // Should show local server controls
    await expect(page.locator('button:has-text("Запустить сервер")')).toBeVisible();
  });

  test('Admin logout', async ({ page }) => {
    await loginAsAdmin(page);

    // Find and click logout button
    const logoutButton = page.locator('button:has-text("Выйти")');
    await logoutButton.click();

    // Should redirect to login choice
    await page.waitForURL('/', { timeout: 5000 });
    await expect(page.locator('text=Добро пожаловать в SETKI.PRO KEEPER')).toBeVisible();
  });
});
