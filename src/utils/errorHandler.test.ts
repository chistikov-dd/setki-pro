import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AppError,
  ErrorType,
  ErrorSeverity,
  ErrorFactory,
} from './errorHandler';

describe('AppError', () => {
  it('should create error with all properties', () => {
    const error = new AppError(
      ErrorType.VALIDATION_ERROR,
      'User friendly message',
      'Test error',
      ErrorSeverity.WARNING,
      false,
      { field: 'email' }
    );

    expect(error.technicalMessage).toBe('Test error');
    expect(error.type).toBe(ErrorType.VALIDATION_ERROR);
    expect(error.severity).toBe(ErrorSeverity.WARNING);
    expect(error.userMessage).toBe('User friendly message');
    expect(error.context).toEqual({ field: 'email' });
    expect(error.retryable).toBe(false);
    expect(error.timestamp).toBeTypeOf('number');
  });

  it('should mark network errors as retryable', () => {
    const error = new AppError(
      ErrorType.NETWORK_ERROR,
      'Connection failed',
      'Network error',
      ErrorSeverity.ERROR,
      true
    );

    expect(error.retryable).toBe(true);
  });

  it('should log error correctly', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new AppError(
      ErrorType.NETWORK_ERROR,
      'User message',
      'Technical message',
      ErrorSeverity.ERROR
    );

    error.log();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('should convert to JSON', () => {
    const error = new AppError(
      ErrorType.VALIDATION_ERROR,
      'User message',
      'Technical message',
      ErrorSeverity.WARNING,
      false,
      { field: 'test' }
    );

    const json = error.toJSON();

    expect(json).toEqual({
      type: ErrorType.VALIDATION_ERROR,
      severity: ErrorSeverity.WARNING,
      userMessage: 'User message',
      technicalMessage: 'Technical message',
      timestamp: expect.any(Number),
      context: { field: 'test' },
    });
  });
});

describe('ErrorFactory', () => {
  describe('networkError', () => {
    it('should create network error', () => {
      const error = ErrorFactory.networkError('Connection timeout');

      expect(error.type).toBe(ErrorType.NETWORK_ERROR);
      expect(error.retryable).toBe(true);
      expect(error.severity).toBe(ErrorSeverity.ERROR);
      expect(error.userMessage).toContain('Ошибка подключения');
      expect(error.technicalMessage).toBe('Connection timeout');
    });
  });

  describe('authError', () => {
    it('should create auth error', () => {
      const error = ErrorFactory.authError('Invalid credentials');

      expect(error.type).toBe(ErrorType.AUTH_ERROR);
      expect(error.retryable).toBe(false);
      expect(error.severity).toBe(ErrorSeverity.WARNING);
      expect(error.userMessage).toContain('логин или пароль');
    });
  });

  describe('validationError', () => {
    it('should create validation error', () => {
      const error = ErrorFactory.validationError('Поле обязательно', { field: 'email' });

      expect(error.type).toBe(ErrorType.VALIDATION_ERROR);
      expect(error.severity).toBe(ErrorSeverity.WARNING);
      expect(error.userMessage).toBe('Поле обязательно');
      expect(error.context?.field).toBe('email');
    });
  });

  describe('databaseError', () => {
    it('should create database error', () => {
      const error = ErrorFactory.databaseError('SQLite error: database is locked');

      expect(error.type).toBe(ErrorType.DATABASE_ERROR);
      expect(error.severity).toBe(ErrorSeverity.CRITICAL);
      expect(error.userMessage).toContain('базой данных');
    });
  });

  describe('fromTauriError', () => {
    it('should parse network errors', () => {
      const tauriError = 'Network error: Connection refused';
      const appError = ErrorFactory.fromTauriError(tauriError);

      expect(appError.type).toBe(ErrorType.NETWORK_ERROR);
      expect(appError.retryable).toBe(true);
      expect(appError.userMessage).toContain('Ошибка подключения');
    });

    it('should parse auth errors', () => {
      const tauriError = '401 Unauthorized';
      const appError = ErrorFactory.fromTauriError(tauriError);

      expect(appError.type).toBe(ErrorType.AUTH_ERROR);
      expect(appError.userMessage).toContain('логин или пароль');
    });

    it('should parse PIN errors', () => {
      const tauriError = 'Invalid PIN code';
      const appError = ErrorFactory.fromTauriError(tauriError);

      expect(appError.type).toBe(ErrorType.AUTH_ERROR);
      expect(appError.userMessage).toContain('PIN-код');
    });

    it('should parse database errors', () => {
      const tauriError = 'SQLite error: database is locked';
      const appError = ErrorFactory.fromTauriError(tauriError);

      expect(appError.type).toBe(ErrorType.DATABASE_ERROR);
      expect(appError.severity).toBe(ErrorSeverity.CRITICAL);
      expect(appError.userMessage).toContain('базой данных');
    });

    it('should parse timeout errors', () => {
      const tauriError = 'Request timeout';
      const appError = ErrorFactory.fromTauriError(tauriError);

      expect(appError.type).toBe(ErrorType.TIMEOUT_ERROR);
    });

    it('should parse not found errors', () => {
      const tauriError = '404 Not found';
      const appError = ErrorFactory.fromTauriError(tauriError);

      expect(appError.type).toBe(ErrorType.NOT_FOUND);
    });

    it('should handle unknown errors', () => {
      const tauriError = 'Something went wrong';
      const appError = ErrorFactory.fromTauriError(tauriError);

      expect(appError.type).toBe(ErrorType.UNKNOWN_ERROR);
      expect(appError.userMessage).toContain('неизвестная ошибка');
    });

    it('should add context from options', () => {
      const tauriError = 'Error';
      const appError = ErrorFactory.fromTauriError(tauriError, {
        action: 'login',
        userId: 123,
      });

      expect(appError.context).toEqual({ action: 'login', userId: 123 });
    });
  });
});
