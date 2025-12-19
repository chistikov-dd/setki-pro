/**
 * Retry logic для критичных операций
 *
 * Используется для:
 * - Синхронизация данных
 * - WebSocket подключения
 * - Критичные API запросы
 */

export interface RetryOptions {
  /** Максимальное количество попыток (включая первую) */
  maxAttempts?: number;

  /** Начальная задержка в мс */
  initialDelay?: number;

  /** Максимальная задержка в мс */
  maxDelay?: number;

  /** Множитель для экспоненциальной задержки */
  backoffMultiplier?: number;

  /** Функция проверки, стоит ли повторять попытку */
  shouldRetry?: (error: unknown, attempt: number) => boolean;

  /** Callback при каждой попытке */
  onRetry?: (error: unknown, attempt: number, nextDelay: number) => void;

  /** Timeout для каждой попытки в мс */
  timeout?: number;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'shouldRetry' | 'timeout'>> = {
  maxAttempts: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
};

/**
 * Задержка выполнения
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Вычислить задержку с экспоненциальным backoff
 */
function calculateDelay(
  attempt: number,
  initialDelay: number,
  maxDelay: number,
  backoffMultiplier: number
): number {
  const exponentialDelay = initialDelay * Math.pow(backoffMultiplier, attempt - 1);
  return Math.min(exponentialDelay, maxDelay);
}

/**
 * Выполнить async функцию с повторными попытками
 *
 * @example
 * const result = await retryAsync(
 *   () => syncChanges(),
 *   {
 *     maxAttempts: 5,
 *     initialDelay: 2000,
 *     onRetry: (error, attempt, nextDelay) => {
 *       console.log(`Попытка ${attempt} провалилась, повтор через ${nextDelay}мс`);
 *     }
 *   }
 * );
 */
export async function retryAsync<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts,
    initialDelay,
    maxDelay,
    backoffMultiplier,
  } = { ...DEFAULT_OPTIONS, ...options };

  const { shouldRetry, onRetry, timeout } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Если задан timeout, выполняем с лимитом времени
      if (timeout) {
        return await withTimeout(fn(), timeout);
      }
      return await fn();
    } catch (error) {
      lastError = error;

      // Проверяем, стоит ли повторять
      const shouldRetryError = shouldRetry ? shouldRetry(error, attempt) : true;

      if (!shouldRetryError || attempt >= maxAttempts) {
        throw error;
      }

      // Вычисляем задержку
      const nextDelay = calculateDelay(attempt, initialDelay, maxDelay, backoffMultiplier);

      // Callback при повторе
      onRetry?.(error, attempt, nextDelay);

      // Ждем перед следующей попыткой
      await delay(nextDelay);
    }
  }

  // Не должны сюда попасть, но на всякий случай
  throw lastError;
}

/**
 * Выполнить функцию с timeout
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

/**
 * Retry для WebSocket подключений
 * (более агрессивные настройки)
 */
export async function retryWebSocket<T>(
  fn: () => Promise<T>,
  options: Omit<RetryOptions, 'maxAttempts' | 'initialDelay'> = {}
): Promise<T> {
  return retryAsync(fn, {
    maxAttempts: 5,
    initialDelay: 1000,
    maxDelay: 16000,
    backoffMultiplier: 2,
    ...options,
  });
}

/**
 * Retry для синхронизации данных
 * (более терпеливые настройки)
 */
export async function retrySync<T>(
  fn: () => Promise<T>,
  options: Omit<RetryOptions, 'maxAttempts' | 'initialDelay'> = {}
): Promise<T> {
  return retryAsync(fn, {
    maxAttempts: 3,
    initialDelay: 2000,
    maxDelay: 10000,
    backoffMultiplier: 2,
    ...options,
  });
}

/**
 * Retry для критичных операций
 * (много попыток с большими задержками)
 */
export async function retryCritical<T>(
  fn: () => Promise<T>,
  options: Omit<RetryOptions, 'maxAttempts' | 'initialDelay'> = {}
): Promise<T> {
  return retryAsync(fn, {
    maxAttempts: 10,
    initialDelay: 5000,
    maxDelay: 60000,
    backoffMultiplier: 1.5,
    ...options,
  });
}

/**
 * Проверка, является ли ошибка временной (retryable)
 */
export function isRetryableError(error: unknown): boolean {
  const errorStr = String(error);

  // Network errors
  if (
    errorStr.includes('Network') ||
    errorStr.includes('connection') ||
    errorStr.includes('Connection') ||
    errorStr.includes('ECONNREFUSED') ||
    errorStr.includes('ETIMEDOUT')
  ) {
    return true;
  }

  // Timeout errors
  if (errorStr.includes('timeout') || errorStr.includes('Timeout')) {
    return true;
  }

  // 5xx server errors
  if (errorStr.includes('500') || errorStr.includes('502') || errorStr.includes('503') || errorStr.includes('504')) {
    return true;
  }

  // 429 Rate limit
  if (errorStr.includes('429')) {
    return true;
  }

  // NOT retryable: 4xx client errors (кроме 429)
  if (
    errorStr.includes('400') ||
    errorStr.includes('401') ||
    errorStr.includes('403') ||
    errorStr.includes('404')
  ) {
    return false;
  }

  // По умолчанию - retryable
  return true;
}

/**
 * Batch retry - выполнить несколько операций с повторами
 * Если одна провалилась - остальные все равно выполняются
 *
 * @example
 * const results = await retryBatch([
 *   () => syncMatch(1),
 *   () => syncMatch(2),
 *   () => syncMatch(3),
 * ]);
 */
export async function retryBatch<T>(
  operations: Array<() => Promise<T>>,
  options: RetryOptions = {}
): Promise<Array<{ success: boolean; result?: T; error?: unknown }>> {
  const promises = operations.map(async (op) => {
    try {
      const result = await retryAsync(op, options);
      return { success: true, result };
    } catch (error) {
      return { success: false, error };
    }
  });

  return Promise.all(promises);
}

/**
 * Circuit breaker pattern
 * Прекращает попытки если слишком много ошибок подряд
 */
export class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private readonly threshold: number = 5,
    private readonly timeout: number = 60000 // 1 минута
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Если circuit open - не выполняем
    if (this.state === 'open') {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      if (timeSinceLastFailure < this.timeout) {
        throw new Error('Circuit breaker is OPEN');
      }
      // Переходим в half-open
      this.state = 'half-open';
    }

    try {
      const result = await fn();
      // Успех - сбрасываем счетчик
      this.onSuccess();
      return result;
    } catch (error) {
      // Ошибка - увеличиваем счетчик
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failureCount = 0;
    this.state = 'closed';
  }

  private onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.threshold) {
      this.state = 'open';
      console.warn(`[CircuitBreaker] OPEN after ${this.failureCount} failures`);
    }
  }

  reset() {
    this.failureCount = 0;
    this.state = 'closed';
  }

  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
    };
  }
}
