import { Page } from '@playwright/test';
import {
  waitForTauri,
  mockTauriCommand,
  clearLocalStorage,
} from './tauri-helpers';
import {
  mockAdminAuthResponse,
  mockJudgeAuthResponse,
  mockTournaments,
  mockBrackets,
  mockMatches,
  mockSession,
  mockJudgeSessions,
  mockActiveMatches,
} from '../fixtures/mock-data';

/**
 * Test setup utilities
 */

/**
 * Initialize the app with mocked Tauri commands
 */
export async function setupApp(page: Page) {
  await page.goto('/');
  await waitForTauri(page);
  await clearLocalStorage(page);
}

/**
 * Setup mocks for admin workflow
 */
export async function setupAdminMocks(page: Page) {
  // Mock authentication
  await mockTauriCommand(page, 'login_admin', mockAdminAuthResponse);

  // Mock tournament fetching
  await mockTauriCommand(page, 'get_tournaments', mockTournaments);

  // Mock tournament download
  await mockTauriCommand(page, 'download_tournament', {
    success: true,
    tournament: mockTournaments[0],
    brackets_count: mockBrackets.length,
    matches_count: mockMatches.length,
  });

  // Mock session creation
  await mockTauriCommand(page, 'create_session', mockSession);

  // Mock judge sessions monitoring
  await mockTauriCommand(page, 'get_active_judge_sessions', mockJudgeSessions);

  // Mock active matches monitoring
  await mockTauriCommand(page, 'get_active_matches', mockActiveMatches);

  // Mock sync
  await mockTauriCommand(page, 'sync_changes', {
    synced_count: 5,
    failed_count: 0,
  });
}

/**
 * Setup mocks for judge workflow
 */
export async function setupJudgeMocks(page: Page) {
  // Mock PIN authentication
  await mockTauriCommand(page, 'login_by_pin', mockJudgeAuthResponse);

  // Mock cached brackets
  await mockTauriCommand(page, 'get_cached_brackets', mockBrackets);

  // Mock bracket reservation
  await mockTauriCommand(page, 'reserve_bracket', { success: true });

  // Mock bracket matches
  await mockTauriCommand(page, 'get_bracket_matches', mockMatches);

  // Mock match operations
  await mockTauriCommand(page, 'start_match', { success: true });
  await mockTauriCommand(page, 'update_match_score', { success: true });
  await mockTauriCommand(page, 'finish_match', { success: true });
  await mockTauriCommand(page, 'batch_update_match', { success: true });

  // Mock match events
  await mockTauriCommand(page, 'record_match_event', { success: true });
  await mockTauriCommand(page, 'get_match_events', []);
  await mockTauriCommand(page, 'undo_last_event', { success: true });
}

/**
 * Setup mocks for offline mode
 */
export async function setupOfflineMocks(page: Page) {
  // Mock network error for API calls
  await page.route('**/api/v1/**', (route) => {
    route.abort('failed');
  });

  // Mock successful SQLite operations
  await mockTauriCommand(page, 'get_cached_brackets', mockBrackets);
  await mockTauriCommand(page, 'get_bracket_matches', mockMatches);
  await mockTauriCommand(page, 'check_cached_pin', { valid: true });

  // Mock sync queue operations
  await mockTauriCommand(page, 'batch_update_match', {
    success: true,
    queued: true, // Indicates it went to sync_queue
  });
}

/**
 * Login as admin
 */
export async function loginAsAdmin(page: Page, login = 'admin', password = 'password') {
  await page.goto('/');
  await waitForTauri(page);

  // Click "Войти как администратор"
  await page.click('text=Войти как администратор');

  // Fill login form
  await page.fill('input[type="text"]', login);
  await page.fill('input[type="password"]', password);

  // Submit
  await page.click('button:has-text("Войти")');

  // Wait for navigation to admin dashboard
  await page.waitForURL('**/admin', { timeout: 10000 });
}

/**
 * Login as judge
 */
export async function loginAsJudge(page: Page, pin = '123456', name = 'Тестовый Судья') {
  await page.goto('/');
  await waitForTauri(page);

  // Click "Войти как судья"
  await page.click('text=Войти как судья');

  // Fill PIN form
  await page.fill('input[placeholder*="PIN"]', pin);
  await page.fill('input[placeholder*="имя"]', name);

  // Submit
  await page.click('button:has-text("Войти")');

  // Wait for navigation to judge dashboard
  await page.waitForURL('**/judge', { timeout: 10000 });
}

/**
 * Create a session as admin
 */
export async function createSession(page: Page) {
  // Assuming we're on admin dashboard
  await page.click('button:has-text("Создать сессию")');

  // Select first tournament
  await page.click('[data-testid="tournament-card"]:first-child');

  // Wait for session to be created and PIN to be displayed
  await page.waitForSelector('text=/PIN: \\d{6}/', { timeout: 10000 });
}

/**
 * Download tournament data
 */
export async function downloadTournament(page: Page) {
  // Click download button on first tournament
  await page.click('[data-testid="download-tournament-btn"]:first-child');

  // Wait for download to complete
  await page.waitForSelector('text=/Загружено/', { timeout: 15000 });
}
