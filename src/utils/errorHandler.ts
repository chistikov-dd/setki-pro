/**
 * Централизованная система обработки ошибок
 *
 * Принципы:
 * 1. Типизированные классы ошибок
 * 2. User-friendly сообщения
 * 3. Автоматическое логирование
 * 4. Graceful degradation
 */

import { useToast } from '../hooks/useToast';

// ============================================
// ТИПЫ ОШИБОК
// ============================================

export enum ErrorType {
  // Network errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  API_ERROR = 'API_ERROR',

  // Auth errors
  AUTH_ERROR = 'AUTH_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',

  // Data errors
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  CONFLICT = 'CONFLICT',

  // System errors
  DATABASE_ERROR = 'DATABASE_ERROR',
  WEBSOCKET_ERROR = 'WEBSOCKET_ERROR',
  LOCAL_SERVER_ERROR = 'LOCAL_SERVER_ERROR',

  // Unknown
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export enum ErrorSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

// ============================================
// КЛАСС ОШИБОК
// ============================================

export class AppError extends Error {
  public readonly type: ErrorType;
  public readonly severity: ErrorSeverity;
  public readonly userMessage: string;
  public readonly technicalMessage: string;
  public readonly retryable: boolean;
  public readonly timestamp: number;
  public readonly context?: Record<string, unknown>;

  constructor(
    type: ErrorType,
    userMessage: string,
    technicalMessage: string,
    severity: ErrorSeverity = ErrorSeverity.ERROR,
    retryable: boolean = false,
    context?: Record<string, unknown>
  ) {
    super(technicalMessage);
    this.name = 'AppError';
    this.type = type;
    this.severity = severity;
    this.userMessage = userMessage;
    this.technicalMessage = technicalMessage;
    this.retryable = retryable;
    this.timestamp = Date.now();
    this.context = context;

    // Для корректного stack trace
    Object.setPrototypeOf(this, AppError.prototype);
  }

  /**
   * Логирование ошибки в консоль
   */
  log() {
    const logData = {
      type: this.type,
      severity: this.severity,
      userMessage: this.userMessage,
      technicalMessage: this.technicalMessage,
      timestamp: new Date(this.timestamp).toISOString(),
      context: this.context,
      stack: this.stack,
    };

    switch (this.severity) {
      case ErrorSeverity.INFO:
        console.info('[AppError]', logData);
        break;
      case ErrorSeverity.WARNING:
        console.warn('[AppError]', logData);
        break;
      case ErrorSeverity.ERROR:
      case ErrorSeverity.CRITICAL:
        console.error('[AppError]', logData);
        break;
    }
  }

  /**
   * Преобразовать в JSON для отправки на сервер
   */
  toJSON() {
    return {
      type: this.type,
      severity: this.severity,
      userMessage: this.userMessage,
      technicalMessage: this.technicalMessage,
      timestamp: this.timestamp,
      context: this.context,
    };
  }
}

// ============================================
// ФАБРИКА ОШИБОК
// ============================================

export class ErrorFactory {
  /**
   * Создать ошибку сети
   */
  static networkError(technicalMessage: string, context?: Record<string, unknown>): AppError {
    return new AppError(
      ErrorType.NETWORK_ERROR,
      'Ошибка подключения к серверу. Проверьте интернет-соединение.',
      technicalMessage,
      ErrorSeverity.ERROR,
      true, // retryable
      context
    );
  }

  /**
   * Создать ошибку авторизации
   */
  static authError(technicalMessage: string, context?: Record<string, unknown>): AppError {
    return new AppError(
      ErrorType.AUTH_ERROR,
      'Неверный логин или пароль.',
      technicalMessage,
      ErrorSeverity.WARNING,
      false,
      context
    );
  }

  /**
   * Создать ошибку PIN-кода
   */
  static pinError(technicalMessage: string, context?: Record<string, unknown>): AppError {
    return new AppError(
      ErrorType.AUTH_ERROR,
      'Неверный PIN-код. Проверьте код и попробуйте снова.',
      technicalMessage,
      ErrorSeverity.WARNING,
      false,
      context
    );
  }

  /**
   * Создать ошибку "Не найдено"
   */
  static notFoundError(resource: string, context?: Record<string, unknown>): AppError {
    return new AppError(
      ErrorType.NOT_FOUND,
      `${resource} не найден.`,
      `Resource not found: ${resource}`,
      ErrorSeverity.WARNING,
      false,
      context
    );
  }

  /**
   * Создать ошибку валидации
   */
  static validationError(message: string, context?: Record<string, unknown>): AppError {
    return new AppError(
      ErrorType.VALIDATION_ERROR,
      message,
      `Validation error: ${message}`,
      ErrorSeverity.WARNING,
      false,
      context
    );
  }

  /**
   * Создать ошибку базы данных
   */
  static databaseError(technicalMessage: string, context?: Record<string, unknown>): AppError {
    return new AppError(
      ErrorType.DATABASE_ERROR,
      'Ошибка работы с локальной базой данных. Попробуйте перезапустить приложение.',
      technicalMessage,
      ErrorSeverity.CRITICAL,
      true,
      context
    );
  }

  /**
   * Создать ошибку WebSocket
   */
  static websocketError(technicalMessage: string, context?: Record<string, unknown>): AppError {
    return new AppError(
      ErrorType.WEBSOCKET_ERROR,
      'Ошибка соединения для синхронизации. Данные будут синхронизированы позже.',
      technicalMessage,
      ErrorSeverity.WARNING,
      true,
      context
    );
  }

  /**
   * Создать ошибку локального сервера
   */
  static localServerError(technicalMessage: string, context?: Record<string, unknown>): AppError {
    return new AppError(
      ErrorType.LOCAL_SERVER_ERROR,
      'Ошибка локального сервера. Проверьте настройки сети.',
      technicalMessage,
      ErrorSeverity.ERROR,
      true,
      context
    );
  }

  /**
   * Создать ошибку таймаута
   */
  static timeoutError(operation: string, context?: Record<string, unknown>): AppError {
    return new AppError(
      ErrorType.TIMEOUT_ERROR,
      `Превышено время ожидания: ${operation}. Попробуйте снова.`,
      `Timeout error: ${operation}`,
      ErrorSeverity.WARNING,
      true,
      context
    );
  }

  /**
   * Создать неизвестную ошибку
   */
  static unknownError(error: unknown, context?: Record<string, unknown>): AppError {
    const message = error instanceof Error ? error.message : String(error);
    return new AppError(
      ErrorType.UNKNOWN_ERROR,
      'Произошла неизвестная ошибка. Попробуйте еще раз.',
      message,
      ErrorSeverity.ERROR,
      false,
      context
    );
  }

  /**
   * Парсинг ошибки от Tauri/Rust
   */
  static fromTauriError(error: unknown, context?: Record<string, unknown>): AppError {
    const errorStr = String(error);

    // Table already occupied error
    if (errorStr.includes('уже занят') || errorStr.includes('already occupied')) {
      // Извлекаем номер стола из сообщения
      const match = errorStr.match(/(\d+)/);
      const tableNumber = match ? match[1] : 'указанный';
      return new AppError(
        ErrorType.VALIDATION_ERROR,
        `Номер стола ${tableNumber} уже занят другим судьей. Пожалуйста, выберите другой номер стола или обратитесь к администратору для освобождения стола.`,
        errorStr,
        ErrorSeverity.WARNING,
        false,
        {
          originalError: errorStr,
          ...context,
        }
      );
    }

    // WebSocket errors (check BEFORE Network since it contains "connection")
    if (errorStr.includes('WebSocket') || errorStr.includes('websocket')) {
      return ErrorFactory.websocketError(errorStr, context);
    }

    // Network errors
    if (errorStr.includes('Network') || errorStr.includes('connection') || errorStr.includes('Connection')) {
      return ErrorFactory.networkError(errorStr, context);
    }

    // Auth errors
    if (errorStr.includes('401') || errorStr.includes('Unauthorized') || errorStr.includes('Invalid credentials')) {
      return ErrorFactory.authError(errorStr, context);
    }

    if (errorStr.includes('Invalid PIN') || errorStr.includes('PIN')) {
      return ErrorFactory.pinError(errorStr, context);
    }

    // Not found
    if (errorStr.includes('404') || errorStr.includes('Not found')) {
      return ErrorFactory.notFoundError('Ресурс', context);
    }

    // Database errors
    if (errorStr.includes('database') || errorStr.includes('SQLite') || errorStr.includes('SQL')) {
      return ErrorFactory.databaseError(errorStr, context);
    }

    // Timeout
    if (errorStr.includes('timeout') || errorStr.includes('Timeout')) {
      return ErrorFactory.timeoutError('операция', context);
    }

    // Default
    return ErrorFactory.unknownError(error, context);
  }
}

// ============================================
// ERROR HANDLER
// ============================================

export class ErrorHandler {
  /**
   * Обработать ошибку с автоматическим логированием и Toast уведомлением
   */
  static handle(
    error: unknown,
    options?: {
      showToast?: boolean;
      logToConsole?: boolean;
      context?: Record<string, unknown>;
    }
  ): AppError {
    const {
      showToast = true,
      logToConsole = true,
      context,
    } = options || {};

    // Преобразовать в AppError
    let appError: AppError;
    if (error instanceof AppError) {
      appError = error;
    } else {
      appError = ErrorFactory.fromTauriError(error, context);
    }

    // Логирование
    if (logToConsole) {
      appError.log();
    }

    // Toast уведомление (только если не вызвано из React компонента напрямую)
    // В React компонентах используйте useErrorHandler hook
    if (showToast && typeof window !== 'undefined') {
      // Отложенный вызов, чтобы не блокировать sync код
      setTimeout(() => {
        // Получаем toast из window (хак для доступа вне React)
        const event = new CustomEvent('app-error', {
          detail: {
            message: appError.userMessage,
            type: appError.severity === ErrorSeverity.CRITICAL ? 'error' : 'warning'
          }
        });
        window.dispatchEvent(event);
      }, 0);
    }

    return appError;
  }

  /**
   * Обработать async функцию с автоматическим error handling
   */
  static async handleAsync<T>(
    fn: () => Promise<T>,
    options?: {
      showToast?: boolean;
      logToConsole?: boolean;
      context?: Record<string, unknown>;
      fallbackValue?: T;
    }
  ): Promise<T | undefined> {
    try {
      return await fn();
    } catch (error) {
      ErrorHandler.handle(error, options);
      return options?.fallbackValue;
    }
  }
}

// ============================================
// REACT HOOK
// ============================================

/**
 * Hook для обработки ошибок в React компонентах
 */
export function useErrorHandler() {
  const { showToast } = useToast();

  const handleError = (
    error: unknown,
    options?: {
      context?: Record<string, unknown>;
      silent?: boolean;
    }
  ): AppError => {
    const { context, silent = false } = options || {};

    // Преобразовать в AppError
    let appError: AppError;
    if (error instanceof AppError) {
      appError = error;
    } else {
      appError = ErrorFactory.fromTauriError(error, context);
    }

    // Логирование
    appError.log();

    // Toast уведомление
    if (!silent) {
      const toastType = appError.severity === ErrorSeverity.CRITICAL ? 'error' : 'warning';
      showToast(appError.userMessage, toastType, 5000);
    }

    return appError;
  };

  const handleAsync = async <T,>(
    fn: () => Promise<T>,
    options?: {
      context?: Record<string, unknown>;
      silent?: boolean;
      fallbackValue?: T;
    }
  ): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (error) {
      handleError(error, options);
      return options?.fallbackValue;
    }
  };

  return { handleError, handleAsync };
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Проверить, является ли ошибка повторяемой (retryable)
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.retryable;
  }
  return false;
}
