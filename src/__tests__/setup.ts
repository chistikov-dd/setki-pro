/**
 * Vitest setup file
 * Runs before all tests
 */

// Mock Tauri API for unit tests
global.window = global.window || {};
(global.window as any).__TAURI__ = {
  invoke: vi.fn(),
  event: {
    emit: vi.fn(),
    listen: vi.fn(),
  },
};

// Suppress console errors in tests (optional)
// global.console.error = vi.fn();
