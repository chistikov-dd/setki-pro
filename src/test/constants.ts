/**
 * Test constants used across all tests
 */

export const TEST_CREDENTIALS = {
  ADMIN: {
    login: 'test_admin',
    password: 'test_password',
  },
  JUDGE: {
    pin: '123456',
    name: 'Тестовый Судья',
  },
};

export const TEST_TIMEOUTS = {
  SHORT: 1000,
  MEDIUM: 3000,
  LONG: 5000,
  TAURI_COMMAND: 10000,
};

export const TEST_URLS = {
  API_BASE: 'http://localhost:8000/api/v1',
  WS_BASE: 'ws://localhost:8000/api/v1/ws',
  LOCAL_SERVER: 'http://localhost:8081/api/v1',
};

export const TEST_IDS = {
  TOURNAMENT: 1,
  BRACKET: 1,
  MATCH: 1,
  USER_ADMIN: 1,
  USER_JUDGE: 2,
};

/**
 * Wait for specified milliseconds
 */
export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry a function until it succeeds or max attempts reached
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  delay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxAttempts) {
        await wait(delay);
      }
    }
  }

  throw lastError;
}
