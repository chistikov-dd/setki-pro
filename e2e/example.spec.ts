import { test, expect } from '@playwright/test';
import { waitForAppReady } from './helpers';

/**
 * Example E2E test to verify Playwright setup
 *
 * Note: These tests require the Tauri app to be running in dev mode
 * Run with: npm run test:e2e
 */

test.describe('App smoke tests', () => {
  test('should load the app', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Check that the app loaded successfully
    await expect(page).toHaveTitle(/SETKI/);
  });

  test('should show login choice page', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Should show two login options
    await expect(page.locator('text=Вход как администратор')).toBeVisible();
    await expect(page.locator('text=Вход как судья')).toBeVisible();
  });

  test('should navigate to admin login', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await page.click('text=Вход как администратор');

    // Should show login form
    await expect(page.locator('input[name="login"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });

  test('should navigate to judge login', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await page.click('text=Вход как судья');

    // Should show PIN form
    await expect(page.locator('input[name="pin"]')).toBeVisible();
    await expect(page.locator('input[name="judgeName"]')).toBeVisible();
  });

  test('should show validation errors on empty admin login', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await page.click('text=Вход как администратор');

    // Try to submit without filling fields
    await page.click('button[type="submit"]');

    // Should show validation errors (HTML5 validation will prevent submit)
    const loginInput = page.locator('input[name="login"]');
    await expect(loginInput).toHaveAttribute('required');
  });

  test('should be responsive', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Test different viewport sizes
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.locator('body')).toBeVisible();

    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(page.locator('body')).toBeVisible();

    await page.setViewportSize({ width: 3840, height: 2160 });
    await expect(page.locator('body')).toBeVisible();
  });
});
