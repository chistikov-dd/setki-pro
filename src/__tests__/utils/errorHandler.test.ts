import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AppError,
  ErrorType,
  ErrorSeverity,
  ErrorFactory,
  isRetryableError,
} from '../../utils/errorHandler';

describe('AppError', () => {
  it('should create an error with correct properties', () => {
    const error = new AppError(
      ErrorType.NETWORK_ERROR,
      'Ошибка сети',
      'Network request failed',
      ErrorSeverity.ERROR,
      true,
      { url: '/api/test' }
    );

    expect(error.type).toBe(ErrorType.NETWORK_ERROR);
    expect(error.userMessage).toBe('Ошибка сети');
    expect(error.technicalMessage).toBe('Network request failed');
    expect(error.severity).toBe(ErrorSeverity.ERROR);
    expect(error.retryable).toBe(true);
    expect(error.context).toEqual({ url: '/api/test' });
    expect(error.timestamp).toBeGreaterThan(0);
    expect(error.name).toBe('AppError');
  });

  it('should have default severity and retryable values', () => {
    const error = new AppError(
      ErrorType.VALIDATION_ERROR,
      'Неверные данные',
      'Invalid input'
    );

    expect(error.severity).toBe(ErrorSeverity.ERROR);
    expect(error.retryable).toBe(false);
  });

  it('should be instance of Error and AppError', () => {
    const error = new AppError(
      ErrorType.UNKNOWN_ERROR,
      'Неизвестная ошибка',
      'Unknown error occurred'
    );

    expect(error instanceof Error).toBe(true);
    expect(error instanceof AppError).toBe(true);
  });

  it('should log with correct severity', () => {
    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const infoError = new AppError(
      ErrorType.VALIDATION_ERROR,
      'Info',
      'info',
      ErrorSeverity.INFO
    );
    infoError.log();
    expect(consoleInfoSpy).toHaveBeenCalled();

    const warningError = new AppError(
      ErrorType.VALIDATION_ERROR,
      'Warning',
      'warning',
      ErrorSeverity.WARNING
    );
    warningError.log();
    expect(consoleWarnSpy).toHaveBeenCalled();

    const errorError = new AppError(
      ErrorType.NETWORK_ERROR,
      'Error',
      'error',
      ErrorSeverity.ERROR
    );
    errorError.log();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});

describe('ErrorFactory', () => {
  describe('fromTauriError', () => {
    it('should parse network error', () => {
      const tauriError = 'Network error: ECONNREFUSED';
      const error = ErrorFactory.fromTauriError(tauriError);

      expect(error.type).toBe(ErrorType.NETWORK_ERROR);
      expect(error.userMessage).toContain('подключения к серверу');
      expect(error.retryable).toBe(true);
    });

    it('should parse timeout error', () => {
      const tauriError = 'Request timeout after 30000ms';
      const error = ErrorFactory.fromTauriError(tauriError);

      expect(error.type).toBe(ErrorType.TIMEOUT_ERROR);
      expect(error.userMessage).toContain('Превышено время ожидания');
      expect(error.retryable).toBe(true);
    });

    it('should parse 401 error', () => {
      const tauriError = 'HTTP 401: Unauthorized';
      const error = ErrorFactory.fromTauriError(tauriError);

      expect(error.type).toBe(ErrorType.AUTH_ERROR);
      expect(error.userMessage).toContain('логин или пароль');
    });

    it('should parse 403 error', () => {
      const tauriError = '403 Forbidden';
      const error = ErrorFactory.fromTauriError(tauriError);

      // 403 не обрабатывается отдельно, падает в UNKNOWN_ERROR
      expect(error.type).toBe(ErrorType.UNKNOWN_ERROR);
      expect(error.userMessage).toContain('неизвестная ошибка');
    });

    it('should parse 404 error', () => {
      const tauriError = '404 Not Found';
      const error = ErrorFactory.fromTauriError(tauriError);

      expect(error.type).toBe(ErrorType.NOT_FOUND);
      expect(error.userMessage).toContain('не найден');
    });

    it('should parse database error', () => {
      const tauriError = 'SQLite error: database locked';
      const error = ErrorFactory.fromTauriError(tauriError);

      expect(error.type).toBe(ErrorType.DATABASE_ERROR);
      expect(error.severity).toBe(ErrorSeverity.CRITICAL);
      expect(error.userMessage).toContain('базой данных');
    });

    it('should parse WebSocket error', () => {
      const tauriError = 'WebSocket connection failed';
      const error = ErrorFactory.fromTauriError(tauriError);

      expect(error.type).toBe(ErrorType.WEBSOCKET_ERROR);
      expect(error.retryable).toBe(true);
    });

    it('should parse invalid PIN error', () => {
      const tauriError = 'Invalid PIN code';
      const error = ErrorFactory.fromTauriError(tauriError);

      expect(error.type).toBe(ErrorType.AUTH_ERROR);
      expect(error.userMessage).toContain('PIN');
    });

    it('should include context if provided', () => {
      const tauriError = 'Network error';
      const context = { endpoint: '/api/test', method: 'POST' };
      const error = ErrorFactory.fromTauriError(tauriError, context);

      expect(error.context).toEqual(context);
    });

    it('should handle unknown errors', () => {
      const tauriError = 'Some random error message';
      const error = ErrorFactory.fromTauriError(tauriError);

      expect(error.type).toBe(ErrorType.UNKNOWN_ERROR);
      expect(error.userMessage).toContain('неизвестная ошибка');
    });
  });

  describe('network', () => {
    it('should create network error', () => {
      const error = ErrorFactory.networkError('Connection refused');

      expect(error.type).toBe(ErrorType.NETWORK_ERROR);
      expect(error.retryable).toBe(true);
      expect(error.technicalMessage).toBe('Connection refused');
    });
  });

  describe('auth', () => {
    it('should create auth error', () => {
      const error = ErrorFactory.authError('Invalid credentials');

      expect(error.type).toBe(ErrorType.AUTH_ERROR);
      expect(error.retryable).toBe(false);
      expect(error.technicalMessage).toBe('Invalid credentials');
    });
  });

  describe('database', () => {
    it('should create database error with critical severity', () => {
      const error = ErrorFactory.databaseError('DB connection failed');

      expect(error.type).toBe(ErrorType.DATABASE_ERROR);
      expect(error.severity).toBe(ErrorSeverity.CRITICAL);
      expect(error.retryable).toBe(true);
    });
  });

  describe('validation', () => {
    it('should create validation error', () => {
      const error = ErrorFactory.validationError('Required field missing');

      expect(error.type).toBe(ErrorType.VALIDATION_ERROR);
      expect(error.retryable).toBe(false);
      expect(error.technicalMessage).toContain('Validation error');
    });
  });
});

describe('isRetryableError', () => {
  it('should return true for retryable error', () => {
    const error = ErrorFactory.networkError('Connection error');
    expect(isRetryableError(error)).toBe(true);
  });

  it('should return false for non-retryable error', () => {
    const error = ErrorFactory.authError('Invalid credentials');
    expect(isRetryableError(error)).toBe(false);
  });

  it('should return false for non-AppError', () => {
    const error = new Error('Standard error');
    expect(isRetryableError(error)).toBe(false);
  });

  it('should return false for non-Error objects', () => {
    expect(isRetryableError('string error')).toBe(false);
    expect(isRetryableError({ message: 'object' })).toBe(false);
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });
});
