import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { retryAsync, withTimeout, retryWebSocket, retrySync, retryCritical } from '../../utils/retry';

describe('retryAsync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should succeed on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    const promise = retryAsync(fn);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and eventually succeed', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('success');

    const promise = retryAsync(fn, { initialDelay: 100 });

    // First attempt fails
    await vi.advanceTimersByTimeAsync(0);

    // Wait for retry delay (100ms)
    await vi.advanceTimersByTimeAsync(100);

    // Second attempt fails
    await vi.advanceTimersByTimeAsync(0);

    // Wait for retry delay (200ms with backoff=2)
    await vi.advanceTimersByTimeAsync(200);

    // Third attempt succeeds
    await vi.advanceTimersByTimeAsync(0);

    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should throw error after max attempts', async () => {
    const error = new Error('persistent failure');
    const fn = vi.fn().mockRejectedValue(error);

    const promise = retryAsync(fn, { maxAttempts: 3, initialDelay: 100 });
    // Prevent unhandled rejection warnings
    promise.catch(() => {});

    // Attempt 1 fails
    await vi.advanceTimersByTimeAsync(0);

    // Delay before attempt 2 (100ms)
    await vi.advanceTimersByTimeAsync(100);

    // Attempt 2 fails
    await vi.advanceTimersByTimeAsync(0);

    // Delay before attempt 3 (200ms)
    await vi.advanceTimersByTimeAsync(200);

    // Attempt 3 fails - should throw
    await vi.advanceTimersByTimeAsync(0);

    await expect(promise).rejects.toThrow('persistent failure');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should use exponential backoff', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    const onRetry = vi.fn();

    const promise = retryAsync(fn, {
      maxAttempts: 4,
      initialDelay: 1000,
      backoffMultiplier: 2,
      onRetry,
    });
    // Prevent unhandled rejection warnings
    promise.catch(() => {});

    // Attempt 1 fails
    await vi.advanceTimersByTimeAsync(0);
    expect(onRetry).toHaveBeenLastCalledWith(expect.any(Error), 1, 1000);

    // Wait for first retry (1000ms)
    await vi.advanceTimersByTimeAsync(1000);

    // Attempt 2 fails
    await vi.advanceTimersByTimeAsync(0);
    expect(onRetry).toHaveBeenLastCalledWith(expect.any(Error), 2, 2000);

    // Wait for second retry (2000ms)
    await vi.advanceTimersByTimeAsync(2000);

    // Attempt 3 fails
    await vi.advanceTimersByTimeAsync(0);
    expect(onRetry).toHaveBeenLastCalledWith(expect.any(Error), 3, 4000);

    // Wait for third retry (4000ms)
    await vi.advanceTimersByTimeAsync(4000);

    // Attempt 4 fails - no more retries
    await vi.advanceTimersByTimeAsync(0);

    await expect(promise).rejects.toThrow('fail');
    expect(onRetry).toHaveBeenCalledTimes(3);
  });

  it('should respect maxDelay', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    const onRetry = vi.fn();

    const promise = retryAsync(fn, {
      maxAttempts: 5,
      initialDelay: 1000,
      maxDelay: 3000,
      backoffMultiplier: 2,
      onRetry,
    });
    // Prevent unhandled rejection warnings
    promise.catch(() => {});

    // Attempt 1 fails
    await vi.advanceTimersByTimeAsync(0);
    expect(onRetry).toHaveBeenLastCalledWith(expect.any(Error), 1, 1000);

    await vi.advanceTimersByTimeAsync(1000);

    // Attempt 2 fails
    await vi.advanceTimersByTimeAsync(0);
    expect(onRetry).toHaveBeenLastCalledWith(expect.any(Error), 2, 2000);

    await vi.advanceTimersByTimeAsync(2000);

    // Attempt 3 fails - delay should be capped at maxDelay (3000ms, not 4000ms)
    await vi.advanceTimersByTimeAsync(0);
    expect(onRetry).toHaveBeenLastCalledWith(expect.any(Error), 3, 3000);

    await vi.advanceTimersByTimeAsync(3000);

    // Attempt 4 fails - still capped at 3000ms
    await vi.advanceTimersByTimeAsync(0);
    expect(onRetry).toHaveBeenLastCalledWith(expect.any(Error), 4, 3000);

    await vi.advanceTimersByTimeAsync(3000);

    // Attempt 5 fails - no more retries
    await vi.advanceTimersByTimeAsync(0);

    await expect(promise).rejects.toThrow('fail');
  });

  it('should use shouldRetry callback', async () => {
    const retryableError = new Error('retryable');
    const nonRetryableError = new Error('non-retryable');

    const fn = vi
      .fn()
      .mockRejectedValueOnce(retryableError)
      .mockRejectedValueOnce(nonRetryableError);

    const shouldRetry = vi.fn((error: Error) => error.message === 'retryable');

    const promise = retryAsync(fn, {
      initialDelay: 100,
      shouldRetry,
    });
    // Prevent unhandled rejection warnings
    promise.catch(() => {});

    // First attempt fails with retryable error
    await vi.advanceTimersByTimeAsync(0);
    expect(shouldRetry).toHaveBeenCalledWith(retryableError, 1);

    // Retry delay
    await vi.advanceTimersByTimeAsync(100);

    // Second attempt fails with non-retryable error - should throw immediately
    await vi.advanceTimersByTimeAsync(0);
    expect(shouldRetry).toHaveBeenCalledWith(nonRetryableError, 2);

    await expect(promise).rejects.toThrow('non-retryable');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should call onRetry callback', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockResolvedValue('success');

    const onRetry = vi.fn();

    const promise = retryAsync(fn, {
      initialDelay: 100,
      onRetry,
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);

    await promise;

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, 100);
  });
});

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should resolve if promise completes before timeout', async () => {
    const promise = new Promise((resolve) => {
      setTimeout(() => resolve('success'), 500);
    });

    const timeoutPromise = withTimeout(promise, 1000);

    vi.advanceTimersByTime(500);

    await expect(timeoutPromise).resolves.toBe('success');
  });

  it('should reject if promise times out', async () => {
    const promise = new Promise((resolve) => {
      setTimeout(() => resolve('too late'), 2000);
    });

    const timeoutPromise = withTimeout(promise, 1000);

    vi.advanceTimersByTime(1000);

    await expect(timeoutPromise).rejects.toThrow('Timeout after 1000ms');
  });
});

describe('retryWebSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should use WebSocket retry settings', async () => {
    const fn = vi.fn().mockResolvedValue('connected');

    const promise = retryWebSocket(fn);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe('connected');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry up to 5 times for WebSocket', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('connection failed'));
    const onRetry = vi.fn();

    const promise = retryWebSocket(fn, { onRetry });
    // Prevent unhandled rejection warnings
    promise.catch(() => {});

    // 5 attempts with delays: 1000, 2000, 4000, 8000
    await vi.advanceTimersByTimeAsync(0); // Attempt 1
    await vi.advanceTimersByTimeAsync(1000); // Delay
    await vi.advanceTimersByTimeAsync(0); // Attempt 2
    await vi.advanceTimersByTimeAsync(2000); // Delay
    await vi.advanceTimersByTimeAsync(0); // Attempt 3
    await vi.advanceTimersByTimeAsync(4000); // Delay
    await vi.advanceTimersByTimeAsync(0); // Attempt 4
    await vi.advanceTimersByTimeAsync(8000); // Delay
    await vi.advanceTimersByTimeAsync(0); // Attempt 5 - final

    await expect(promise).rejects.toThrow('connection failed');
    expect(fn).toHaveBeenCalledTimes(5);
    expect(onRetry).toHaveBeenCalledTimes(4);
  });
});

describe('retrySync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should use sync retry settings (3 attempts, 2-10s delays)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('sync failed'));

    const promise = retrySync(fn);
    // Prevent unhandled rejection warnings
    promise.catch(() => {});

    // 3 attempts with delays: 2000, 4000
    await vi.advanceTimersByTimeAsync(0); // Attempt 1
    await vi.advanceTimersByTimeAsync(2000); // Delay
    await vi.advanceTimersByTimeAsync(0); // Attempt 2
    await vi.advanceTimersByTimeAsync(4000); // Delay
    await vi.advanceTimersByTimeAsync(0); // Attempt 3 - final

    await expect(promise).rejects.toThrow('sync failed');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('retryCritical', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should use critical retry settings (10 attempts, 5-60s delays)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('critical failure'));

    const promise = retryCritical(fn);
    // Prevent unhandled rejection warnings
    promise.catch(() => {});

    // Start attempts
    await vi.advanceTimersByTimeAsync(0); // Attempt 1
    await vi.advanceTimersByTimeAsync(5000); // Delay 5s
    await vi.advanceTimersByTimeAsync(0); // Attempt 2
    await vi.advanceTimersByTimeAsync(10000); // Delay 10s
    await vi.advanceTimersByTimeAsync(0); // Attempt 3
    await vi.advanceTimersByTimeAsync(20000); // Delay 20s
    await vi.advanceTimersByTimeAsync(0); // Attempt 4
    await vi.advanceTimersByTimeAsync(40000); // Delay 40s
    await vi.advanceTimersByTimeAsync(0); // Attempt 5
    await vi.advanceTimersByTimeAsync(60000); // Delay 60s (capped at maxDelay)

    // Continue for remaining 5 attempts
    for (let i = 6; i <= 10; i++) {
      await vi.advanceTimersByTimeAsync(0);
      if (i < 10) {
        await vi.advanceTimersByTimeAsync(60000); // Max delay
      }
    }

    await expect(promise).rejects.toThrow('critical failure');
    expect(fn).toHaveBeenCalledTimes(10);
  });
});
