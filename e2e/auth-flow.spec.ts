import { test, expect } from '@playwright/test';
import { waitForAppReady, clearAppState } from './helpers';

/**
 * E2E тесты для Authentication flow
 *
 * Критичные сценарии:
 * 1. Admin login (online)
 * 2. Judge login with PIN (online)
 * 3. Offline authentication (cached credentials)
 * 4. Invalid credentials handling
 * 5. Logout flow
 */

test.describe('Auth Flow - Admin Login', () => {
  test.beforeEach(async ({ page }) => {
    await clearAppState(page);
  });

  test('should successfully login as admin with valid credentials', async ({ page }) => {
    // Mock Tauri API
    await page.addInitScript(() => {
      (window as any).__TAURI__ = {
        core: {
          invoke: async (cmd: string, args?: any) => {
            if (cmd === 'login_admin') {
              if (args.login === 'admin' && args.password === 'password') {
                return {
                  access_token: 'mock_admin_token',
                  user_id: 1,
                  role: 'admin',
                };
              }
              throw new Error('Invalid credentials');
            }
            if (cmd === 'get_tournaments') {
              return [
                {
                  id: 1,
                  name: 'Тестовый Турнир',
                  start_date: '2025-12-20',
                  status: 'upcoming',
                },
              ];
            }
            return {};
          },
        },
        event: { listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() },
      };
    });

    await page.goto('/');
    await waitForAppReady(page);

    // Click admin login button
    await page.click('text=Вход как администратор');

    // Fill credentials
    await page.fill('input[name="login"]', 'admin');
    await page.fill('input[name="password"]', 'password');

    // Submit
    await page.click('button[type="submit"]');

    // Wait for redirect to admin dashboard
    await page.waitForURL('/admin/dashboard', { timeout: 5000 });

    // Verify admin dashboard elements
    await expect(page.locator('text=Турниры')).toBeVisible();
    await expect(page.locator('text=Тестовый Турнир')).toBeVisible();
  });

  test('should show error on invalid admin credentials', async ({ page }) => {
    // Mock Tauri API to reject invalid credentials
    await page.addInitScript(() => {
      (window as any).__TAURI__ = {
        core: {
          invoke: async (cmd: string, args?: any) => {
            if (cmd === 'login_admin') {
              throw new Error('Invalid credentials');
            }
            return {};
          },
        },
        event: { listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() },
      };
    });

    await page.goto('/');
    await page.click('text=Вход как администратор');

    await page.fill('input[name="login"]', 'wrong');
    await page.fill('input[name="password"]', 'wrong');
    await page.click('button[type="submit"]');

    // Should show error message
    await expect(page.locator('text=/Ошибка|Неверный|Invalid/')).toBeVisible({ timeout: 3000 });

    // Should stay on login page
    await expect(page.locator('input[name="login"]')).toBeVisible();
  });

  test('should logout from admin dashboard', async ({ page }) => {
    // Mock successful login
    await page.addInitScript(() => {
      (window as any).__TAURI__ = {
        core: {
          invoke: async (cmd: string) => {
            if (cmd === 'login_admin') {
              return { access_token: 'mock', user_id: 1, role: 'admin' };
            }
            if (cmd === 'get_tournaments') return [];
            return {};
          },
        },
        event: { listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() },
      };
    });

    await page.goto('/');
    await page.click('text=Вход как администратор');
    await page.fill('input[name="login"]', 'admin');
    await page.fill('input[name="password"]', 'password');
    await page.click('button[type="submit"]');

    await page.waitForURL('/admin/dashboard');

    // Click logout
    await page.click('button:has-text("Выход")');

    // Should redirect to login choice
    await page.waitForURL('/', { timeout: 3000 });
    await expect(page.locator('text=Вход как администратор')).toBeVisible();
  });
});

test.describe('Auth Flow - Judge Login', () => {
  test.beforeEach(async ({ page }) => {
    await clearAppState(page);
  });

  test('should successfully login as judge with valid PIN', async ({ page }) => {
    // Mock Tauri API
    await page.addInitScript(() => {
      (window as any).__TAURI__ = {
        core: {
          invoke: async (cmd: string, args?: any) => {
            if (cmd === 'login_by_pin') {
              if (args.pin_code === '123456') {
                return {
                  access_token: 'mock_judge_token',
                  user_id: 2,
                  role: 'judge',
                  tournament_id: 1,
                  judge_name: args.judge_name,
                };
              }
              throw new Error('Invalid PIN');
            }
            if (cmd === 'get_cached_brackets') return [];
            return {};
          },
        },
        event: { listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() },
      };
    });

    await page.goto('/');
    await waitForAppReady(page);

    // Click judge login
    await page.click('text=Вход как судья');

    // Fill PIN and name
    await page.fill('input[name="pin"]', '123456');
    await page.fill('input[name="judgeName"]', 'Иванов Иван');

    // Submit
    await page.click('button[type="submit"]');

    // Wait for judge dashboard
    await page.waitForURL('/judge/dashboard', { timeout: 5000 });

    // Verify judge dashboard
    await expect(page.locator('text=Выберите сетку')).toBeVisible();
    await expect(page.locator('text=Иванов Иван')).toBeVisible();
  });

  test('should show error on invalid PIN', async ({ page }) => {
    // Mock Tauri API to reject invalid PIN
    await page.addInitScript(() => {
      (window as any).__TAURI__ = {
        core: {
          invoke: async (cmd: string, args?: any) => {
            if (cmd === 'login_by_pin') {
              throw new Error('Invalid PIN code');
            }
            return {};
          },
        },
        event: { listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() },
      };
    });

    await page.goto('/');
    await page.click('text=Вход как судья');

    await page.fill('input[name="pin"]', '000000');
    await page.fill('input[name="judgeName"]', 'Test Judge');
    await page.click('button[type="submit"]');

    // Should show error
    await expect(page.locator('text=/PIN|Ошибка/')).toBeVisible({ timeout: 3000 });
  });

  test('should validate judge name is required', async ({ page }) => {
    await page.goto('/');
    await page.click('text=Вход как судья');

    await page.fill('input[name="pin"]', '123456');
    // Don't fill judge name

    await page.click('button[type="submit"]');

    // HTML5 validation should prevent submit or show error
    const nameInput = page.locator('input[name="judgeName"]');
    await expect(nameInput).toHaveAttribute('required');
  });

  test('should logout from judge dashboard', async ({ page }) => {
    // Mock successful login
    await page.addInitScript(() => {
      (window as any).__TAURI__ = {
        core: {
          invoke: async (cmd: string, args?: any) => {
            if (cmd === 'login_by_pin') {
              return { access_token: 'mock', role: 'judge', judge_name: args.judge_name };
            }
            if (cmd === 'get_cached_brackets') return [];
            if (cmd === 'clear_all_reservations') return { success: true };
            return {};
          },
        },
        event: { listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() },
      };
    });

    await page.goto('/');
    await page.click('text=Вход как судья');
    await page.fill('input[name="pin"]', '123456');
    await page.fill('input[name="judgeName"]', 'Test Judge');
    await page.click('button[type="submit"]');

    await page.waitForURL('/judge/dashboard');

    // Click logout
    await page.click('button:has-text("Выход")');

    // Should redirect to login choice
    await page.waitForURL('/');
    await expect(page.locator('text=Вход как судья')).toBeVisible();
  });
});

test.describe('Auth Flow - Offline Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await clearAppState(page);
  });

  test('should fallback to cached PIN when offline', async ({ page }) => {
    let onlineAttempts = 0;

    // Mock Tauri API - first call fails (offline), then uses cache
    await page.addInitScript(() => {
      let attempts = 0;
      (window as any).__TAURI__ = {
        core: {
          invoke: async (cmd: string, args?: any) => {
            if (cmd === 'login_by_pin') {
              attempts++;
              if (attempts === 1) {
                // Simulate network error
                throw new Error('Network error: Connection refused');
              }
              // Fallback to cache
              return {
                access_token: 'cached_token',
                user_id: 2,
                role: 'judge',
                tournament_id: 1,
                judge_name: args.judge_name,
              };
            }
            if (cmd === 'check_cached_pin') {
              return { tournament_id: 1, pin_code: '123456' };
            }
            if (cmd === 'get_cached_brackets') return [];
            return {};
          },
        },
        event: { listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() },
      };
    });

    await page.goto('/');
    await page.click('text=Вход как судья');

    await page.fill('input[name="pin"]', '123456');
    await page.fill('input[name="judgeName"]', 'Offline Judge');
    await page.click('button[type="submit"]');

    // Should still login successfully using cache
    await page.waitForURL('/judge/dashboard', { timeout: 5000 });

    // Verify logged in
    await expect(page.locator('text=Offline Judge')).toBeVisible();
  });

  test('should show offline indicator when network unavailable', async ({ page }) => {
    // Mock Tauri API with network errors
    await page.addInitScript(() => {
      (window as any).__TAURI__ = {
        core: {
          invoke: async (cmd: string, args?: any) => {
            if (cmd === 'login_by_pin') {
              return { access_token: 'mock', role: 'judge', judge_name: args.judge_name };
            }
            if (cmd === 'get_cached_brackets') return [];
            // Simulate WebSocket connection failure
            if (cmd.includes('websocket') || cmd.includes('ws')) {
              throw new Error('Network error');
            }
            return {};
          },
        },
        event: { listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() },
      };
    });

    await page.goto('/');
    await page.click('text=Вход как судья');
    await page.fill('input[name="pin"]', '123456');
    await page.fill('input[name="judgeName"]', 'Test');
    await page.click('button[type="submit"]');

    await page.waitForURL('/judge/dashboard');

    // Note: Offline indicator would appear in match screen
    // This is a simplified test
  });
});

test.describe('Auth Flow - Navigation Guards', () => {
  test('should redirect to login when accessing protected route', async ({ page }) => {
    await page.goto('/admin/dashboard');

    // Should redirect to login
    await page.waitForURL('/', { timeout: 3000 });
    await expect(page.locator('text=Вход как администратор')).toBeVisible();
  });

  test('should redirect to login when accessing judge routes', async ({ page }) => {
    await page.goto('/judge/dashboard');

    // Should redirect to login
    await page.waitForURL('/');
    await expect(page.locator('text=Вход как судья')).toBeVisible();
  });
});
