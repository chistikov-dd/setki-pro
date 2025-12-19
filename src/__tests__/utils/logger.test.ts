import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  Logger,
  LogLevel,
  LOG_CATEGORIES,
  logger,
} from '../../utils/logger';

describe('Logger', () => {
  let consoleDebugSpy: any;
  let consoleInfoSpy: any;
  let consoleWarnSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    // Create spies FIRST (before any logger calls)
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Then reset logger state
    logger.clearBuffer();
    logger.setLevel(LogLevel.DEBUG);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setLevel', () => {
    it('should set minimum log level', () => {
      logger.setLevel(LogLevel.WARN);
      logger.debug(LOG_CATEGORIES.SYSTEM, 'debug message');
      logger.info(LOG_CATEGORIES.SYSTEM, 'info message');
      logger.warn(LOG_CATEGORIES.SYSTEM, 'warn message');
      logger.error(LOG_CATEGORIES.SYSTEM, 'error message');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
      expect(consoleInfoSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('debug', () => {
    it('should log debug messages', () => {
      logger.debug(LOG_CATEGORIES.API, 'test debug', { foo: 'bar' });

      expect(consoleDebugSpy).toHaveBeenCalled();
      const call = consoleDebugSpy.mock.calls[0];
      // call[0] is the format string with %c prefix and timestamp
      expect(call[0]).toMatch(/%c\[.*\] \[DEBUG\s+\] \[API\]/);
      expect(call[1]).toBeTruthy(); // CSS style
      expect(call[2]).toBe('test debug');
      expect(call[3]).toEqual({ foo: 'bar' });
    });

    it('should not log debug when level is INFO', () => {
      logger.setLevel(LogLevel.INFO);
      logger.debug(LOG_CATEGORIES.API, 'test debug');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });
  });

  describe('info', () => {
    it('should log info messages', () => {
      logger.info(LOG_CATEGORIES.AUTH, 'test info', { userId: 123 });

      expect(consoleInfoSpy).toHaveBeenCalled();
      const call = consoleInfoSpy.mock.calls[0];
      // call[0] is the format string with %c prefix and timestamp
      expect(call[0]).toMatch(/%c\[.*\] \[INFO\s+\] \[Auth\]/);
      expect(call[1]).toBeTruthy(); // CSS style
      expect(call[2]).toBe('test info');
      expect(call[3]).toEqual({ userId: 123 });
    });

    it('should not log info when level is WARN', () => {
      logger.setLevel(LogLevel.WARN);
      logger.info(LOG_CATEGORIES.AUTH, 'test info');

      expect(consoleInfoSpy).not.toHaveBeenCalled();
    });
  });

  describe('warn', () => {
    it('should log warn messages', () => {
      logger.warn(LOG_CATEGORIES.WEBSOCKET, 'test warn', { reconnectAttempt: 3 });

      expect(consoleWarnSpy).toHaveBeenCalled();
      const call = consoleWarnSpy.mock.calls[0];
      // call[0] is the format string with %c prefix and timestamp
      expect(call[0]).toMatch(/%c\[.*\] \[WARN\s+\] \[WebSocket\]/);
      expect(call[1]).toBeTruthy(); // CSS style
      expect(call[2]).toBe('test warn');
      expect(call[3]).toEqual({ reconnectAttempt: 3 });
    });

    it('should not log warn when level is ERROR', () => {
      logger.setLevel(LogLevel.ERROR);
      logger.warn(LOG_CATEGORIES.WEBSOCKET, 'test warn');

      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('error', () => {
    it('should log error messages with Error object', () => {
      const error = new Error('test error');
      logger.error(LOG_CATEGORIES.DATABASE, 'test error message', {}, error);

      expect(consoleErrorSpy).toHaveBeenCalled();
      const call = consoleErrorSpy.mock.calls[0];
      // call[0] is the format string with %c prefix and timestamp
      expect(call[0]).toMatch(/%c\[.*\] \[ERROR\s+\] \[Database\]/);
      expect(call[1]).toBeTruthy(); // CSS style
      expect(call[2]).toBe('test error message');
    });

    it('should log error messages without Error object', () => {
      logger.error(LOG_CATEGORIES.SYNC, 'sync failed');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const call = consoleErrorSpy.mock.calls[0];
      // call[0] is the format string with %c prefix and timestamp
      expect(call[0]).toMatch(/%c\[.*\] \[ERROR\s+\] \[Sync\]/);
      expect(call[1]).toBeTruthy(); // CSS style
      expect(call[2]).toBe('sync failed');
    });
  });

  describe('critical', () => {
    it('should log critical messages', () => {
      const error = new Error('critical failure');
      logger.critical(LOG_CATEGORIES.SYSTEM, 'critical issue', {}, error);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[CRITICAL]'),
        expect.any(String), // CSS style
        'critical issue',
        {}
      );
    });
  });

  describe('buffer', () => {
    it('should store logs in buffer', () => {
      logger.info(LOG_CATEGORIES.AUTH, 'message 1');
      logger.warn(LOG_CATEGORIES.SYNC, 'message 2');
      logger.error(LOG_CATEGORIES.API, 'message 3');

      const buffer = logger.getLogs();

      expect(buffer).toHaveLength(3);
      expect(buffer[0].message).toBe('message 1');
      expect(buffer[1].message).toBe('message 2');
      expect(buffer[2].message).toBe('message 3');
    });

    it('should limit buffer to 1000 entries', () => {
      // Add 1500 logs
      for (let i = 0; i < 1500; i++) {
        logger.info(LOG_CATEGORIES.SYSTEM, `message ${i}`);
      }

      const buffer = logger.getLogs();

      expect(buffer).toHaveLength(1000);
      // Should keep latest 1000
      expect(buffer[0].message).toBe('message 500');
      expect(buffer[999].message).toBe('message 1499');
    });

    it('should clear buffer', () => {
      logger.info(LOG_CATEGORIES.AUTH, 'message 1');
      logger.info(LOG_CATEGORIES.AUTH, 'message 2');

      expect(logger.getLogs()).toHaveLength(2);

      logger.clearBuffer();

      expect(logger.getLogs()).toHaveLength(0);
    });
  });

  describe('exportLogs', () => {
    it('should export logs as JSON', () => {
      logger.info(LOG_CATEGORIES.AUTH, 'test message', { userId: 123 });

      const json = logger.exportToJSON();
      const parsed = JSON.parse(json);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].level).toBe(LogLevel.INFO);
      expect(parsed[0].category).toBe(LOG_CATEGORIES.AUTH);
      expect(parsed[0].message).toBe('test message');
      expect(parsed[0].data).toEqual({ userId: 123 });
      expect(parsed[0].timestamp).toBeDefined();
    });

    it('should export logs as text', () => {
      logger.info(LOG_CATEGORIES.API, 'message 1');
      logger.error(LOG_CATEGORIES.SYNC, 'message 2');

      const text = logger.exportToText();

      expect(text).toContain('INFO');
      expect(text).toContain(LOG_CATEGORIES.API);
      expect(text).toContain('message 1');
      expect(text).toContain('ERROR');
      expect(text).toContain(LOG_CATEGORIES.SYNC);
      expect(text).toContain('message 2');
    });
  });

  describe('categories', () => {
    it('should support all log categories', () => {
      const categories = [
        LOG_CATEGORIES.AUTH,
        LOG_CATEGORIES.API,
        LOG_CATEGORIES.WEBSOCKET,
        LOG_CATEGORIES.SYNC,
        LOG_CATEGORIES.MATCH,
        LOG_CATEGORIES.BRACKET,
        LOG_CATEGORIES.LOCAL_SERVER,
        LOG_CATEGORIES.DATABASE,
        LOG_CATEGORIES.UI,
        LOG_CATEGORIES.SYSTEM,
      ];

      categories.forEach((category) => {
        logger.info(category, `test ${category}`);
      });

      // Just verify that info was called for all categories
      expect(consoleInfoSpy).toHaveBeenCalledTimes(categories.length);
    });
  });

  describe('metadata', () => {
    it('should include metadata in logs', () => {
      const metadata = {
        userId: 123,
        action: 'login',
        timestamp: Date.now(),
      };

      logger.info(LOG_CATEGORIES.AUTH, 'user logged in', metadata);

      expect(consoleInfoSpy).toHaveBeenCalled();
      const call = consoleInfoSpy.mock.calls[0];
      expect(call[2]).toBe('user logged in');
      expect(call[3]).toEqual(metadata);
    });

    it('should handle empty metadata', () => {
      logger.info(LOG_CATEGORIES.SYSTEM, 'test message');

      expect(consoleInfoSpy).toHaveBeenCalled();
      const call = consoleInfoSpy.mock.calls[0];
      expect(call[2]).toBe('test message');
      expect(call[3]).toBe('');
    });
  });

  describe('timestamps', () => {
    it('should include timestamp in log entries', () => {
      const beforeTime = Date.now();
      logger.info(LOG_CATEGORIES.API, 'test message');
      const afterTime = Date.now();

      const buffer = logger.getLogs();
      const logEntry = buffer[0];

      expect(logEntry.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(logEntry.timestamp).toBeLessThanOrEqual(afterTime);
    });

    it('should format timestamp in console output', () => {
      logger.info(LOG_CATEGORIES.SYSTEM, 'test');

      const callArgs = consoleInfoSpy.mock.calls[0];
      const timestampArg = callArgs[0];

      // Should contain timestamp in ISO format
      expect(timestampArg).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });
});
