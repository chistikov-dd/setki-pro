import { describe, it, expect, vi, beforeEach } from 'vitest';
import { retryAsync, CircuitBreaker, RetryOptions } from './retry';

describe('retryAsync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
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
      .mockRejectedValueOnce(new Error('Fail 1'))
      .mockRejectedValueOnce(new Error('Fail 2'))
      .mockResolvedValue('success');

    const options: RetryOptions = {
      maxAttempts: 3,
      initialDelay: 1000,
    };

    const promise = retryAsync(fn, options);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should throw error after max attempts', async () => {
    const error = new Error('Persistent failure');
    const fn = vi.fn().mockRejectedValue(error);

    const options: RetryOptions = {
      maxAttempts: 3,
      initialDelay: 1000,
    };

    const promise = retryAsync(fn, options);

    await expect(async () => {
      await vi.runAllTimersAsync();
      await promise;
    }).rejects.toThrow('Persistent failure');

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should use exponential backoff', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Fail'));
    const delays: number[] = [];

    const options: RetryOptions = {
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 10000,
      backoffFactor: 2,
      onRetry: (error, attempt, nextDelay) => {
        delays.push(nextDelay);
      },
    };

    const promise = retryAsync(fn, options);

    try {
      await vi.runAllTimersAsync();
      await promise;
    } catch {
      // Expected to fail
    }

    // First retry: 1000ms, Second retry: 2000ms
    expect(delays[0]).toBe(1000);
    expect(delays[1]).toBe(2000);
  });

  it('should respect maxDelay', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Fail'));
    const delays: number[] = [];

    const options: RetryOptions = {
      maxAttempts: 5,
      initialDelay: 1000,
      maxDelay: 3000,
      backoffFactor: 2,
      onRetry: (error, attempt, nextDelay) => {
        delays.push(nextDelay);
      },
    };

    const promise = retryAsync(fn, options);

    try {
      await vi.runAllTimersAsync();
      await promise;
    } catch {
      // Expected to fail
    }

    // Delays: 1000, 2000, 3000 (capped), 3000 (capped)
    expect(delays[0]).toBe(1000);
    expect(delays[1]).toBe(2000);
    expect(delays[2]).toBe(3000);
    expect(delays[3]).toBe(3000);
  });

  it('should call shouldRetry function', async () => {
    const error1 = new Error('Retryable');
    const error2 = new Error('Not retryable');
    const fn = vi
      .fn()
      .mockRejectedValueOnce(error1)
      .mockRejectedValueOnce(error2);

    const shouldRetry = vi.fn((error: Error) => {
      return error.message === 'Retryable';
    });

    const options: RetryOptions = {
      maxAttempts: 3,
      initialDelay: 100,
      shouldRetry,
    };

    const promise = retryAsync(fn, options);

    await expect(async () => {
      await vi.runAllTimersAsync();
      await promise;
    }).rejects.toThrow('Not retryable');

    expect(fn).toHaveBeenCalledTimes(2);
    expect(shouldRetry).toHaveBeenCalledTimes(2);
  });

  it('should call onRetry callback', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Fail'));
    const onRetry = vi.fn();

    const options: RetryOptions = {
      maxAttempts: 2,
      initialDelay: 100,
      onRetry,
    };

    const promise = retryAsync(fn, options);

    try {
      await vi.runAllTimersAsync();
      await promise;
    } catch {
      // Expected to fail
    }

    expect(onRetry).toHaveBeenCalledTimes(1); // Called before second attempt
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, 100);
  });
});

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
    breaker = new CircuitBreaker(3, 5000);
  });

  it('should execute function when circuit is closed', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    const promise = breaker.execute(fn);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should open circuit after threshold failures', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Fail'));

    // Fail 3 times to open circuit
    for (let i = 0; i < 3; i++) {
      try {
        const promise = breaker.execute(fn);
        await vi.runAllTimersAsync();
        await promise;
      } catch {
        // Expected to fail
      }
    }

    // Circuit should now be open
    await expect(async () => {
      const promise = breaker.execute(fn);
      await vi.runAllTimersAsync();
      await promise;
    }).rejects.toThrow('Circuit breaker is OPEN');

    // Function should not be called when circuit is open
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should reset circuit after timeout', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Fail 1'))
      .mockRejectedValueOnce(new Error('Fail 2'))
      .mockRejectedValueOnce(new Error('Fail 3'))
      .mockResolvedValue('success');

    // Fail 3 times to open circuit
    for (let i = 0; i < 3; i++) {
      try {
        const promise = breaker.execute(fn);
        await vi.runAllTimersAsync();
        await promise;
      } catch {
        // Expected
      }
    }

    // Wait for reset timeout (5000ms)
    await vi.advanceTimersByTimeAsync(5000);

    // Circuit should now be half-open, try again
    const promise = breaker.execute(fn);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('should reset failure count on success', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Fail 1'))
      .mockRejectedValueOnce(new Error('Fail 2'))
      .mockResolvedValue('success');

    // Fail twice
    for (let i = 0; i < 2; i++) {
      try {
        const promise = breaker.execute(fn);
        await vi.runAllTimersAsync();
        await promise;
      } catch {
        // Expected
      }
    }

    // Succeed
    const promise = breaker.execute(fn);
    await vi.runAllTimersAsync();
    await promise;

    expect(fn).toHaveBeenCalledTimes(3);

    // Fail twice more - should not open circuit (count was reset)
    fn.mockRejectedValue(new Error('Fail'));
    for (let i = 0; i < 2; i++) {
      try {
        const promise = breaker.execute(fn);
        await vi.runAllTimersAsync();
        await promise;
      } catch {
        // Expected
      }
    }

    // Should still be closed
    fn.mockResolvedValue('success');
    const promise2 = breaker.execute(fn);
    await vi.runAllTimersAsync();
    const result = await promise2;

    expect(result).toBe('success');
  });
});
