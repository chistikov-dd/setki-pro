/**
 * Централизованная система логирования
 *
 * Уровни логирования:
 * - DEBUG: Детальная информация для отладки
 * - INFO: Информационные сообщения
 * - WARN: Предупреждения (не критичные проблемы)
 * - ERROR: Ошибки (требуют внимания)
 * - CRITICAL: Критичные ошибки (требуют немедленного внимания)
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  CRITICAL = 4,
}

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  category: string;
  message: string;
  data?: Record<string, unknown>;
  stack?: string;
}

class Logger {
  private minLevel: LogLevel = LogLevel.INFO;
  private logs: LogEntry[] = [];
  private maxLogs: number = 1000; // Максимум логов в памяти
  private logToConsole: boolean = true;
  private categories: Set<string> = new Set();

  constructor() {
    // В dev режиме показываем все логи
    if (import.meta.env.DEV) {
      this.minLevel = LogLevel.DEBUG;
    }
  }

  /**
   * Установить минимальный уровень логирования
   */
  setLevel(level: LogLevel) {
    this.minLevel = level;
  }

  /**
   * Включить/выключить вывод в консоль
   */
  setConsoleLogging(enabled: boolean) {
    this.logToConsole = enabled;
  }

  /**
   * Логировать сообщение
   */
  private log(
    level: LogLevel,
    category: string,
    message: string,
    data?: Record<string, unknown>,
    error?: Error
  ) {
    // Фильтр по уровню
    if (level < this.minLevel) {
      return;
    }

    // Добавить категорию
    this.categories.add(category);

    // Создать запись
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      category,
      message,
      data,
      stack: error?.stack,
    };

    // Добавить в буфер
    this.logs.push(entry);

    // Ограничить размер буфера
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Вывод в консоль
    if (this.logToConsole) {
      this.printToConsole(entry);
    }

    // TODO: Отправить на сервер для мониторинга (только ERROR и CRITICAL)
    if (level >= LogLevel.ERROR) {
      this.sendToServer(entry);
    }
  }

  /**
   * Вывод в консоль с форматированием
   */
  private printToConsole(entry: LogEntry) {
    const timestamp = new Date(entry.timestamp).toISOString();
    const levelStr = LogLevel[entry.level].padEnd(8);
    const prefix = `[${timestamp}] [${levelStr}] [${entry.category}]`;

    const style = this.getConsoleStyle(entry.level);

    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(`%c${prefix}`, style, entry.message, entry.data || '');
        break;
      case LogLevel.INFO:
        console.info(`%c${prefix}`, style, entry.message, entry.data || '');
        break;
      case LogLevel.WARN:
        console.warn(`%c${prefix}`, style, entry.message, entry.data || '');
        if (entry.stack) console.warn(entry.stack);
        break;
      case LogLevel.ERROR:
        console.error(`%c${prefix}`, style, entry.message, entry.data || '');
        if (entry.stack) console.error(entry.stack);
        break;
      case LogLevel.CRITICAL:
        console.error(`%c${prefix}`, style, entry.message, entry.data || '');
        if (entry.stack) console.error(entry.stack);
        break;
    }
  }

  /**
   * Получить CSS стили для консоли
   */
  private getConsoleStyle(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG:
        return 'color: #666; font-weight: normal';
      case LogLevel.INFO:
        return 'color: #0ea5e9; font-weight: normal';
      case LogLevel.WARN:
        return 'color: #f59e0b; font-weight: bold';
      case LogLevel.ERROR:
        return 'color: #ef4444; font-weight: bold';
      case LogLevel.CRITICAL:
        return 'color: #dc2626; font-weight: bold; background: #fee2e2; padding: 2px 4px';
      default:
        return '';
    }
  }

  /**
   * Отправить на сервер (заглушка)
   */
  private sendToServer(entry: LogEntry) {
    // TODO: Реализовать отправку на сервер для мониторинга
    // Можно использовать Sentry, LogRocket, или свой endpoint
    if (import.meta.env.DEV && !import.meta.env.VITEST) {
      console.debug('[Logger] Would send to server:', entry);
    }
  }

  // ============================================
  // PUBLIC API
  // ============================================

  /**
   * DEBUG уровень
   */
  debug(category: string, message: string, data?: Record<string, unknown>) {
    this.log(LogLevel.DEBUG, category, message, data);
  }

  /**
   * INFO уровень
   */
  info(category: string, message: string, data?: Record<string, unknown>) {
    this.log(LogLevel.INFO, category, message, data);
  }

  /**
   * WARN уровень
   */
  warn(category: string, message: string, data?: Record<string, unknown>, error?: Error) {
    this.log(LogLevel.WARN, category, message, data, error);
  }

  /**
   * ERROR уровень
   */
  error(category: string, message: string, data?: Record<string, unknown>, error?: Error) {
    this.log(LogLevel.ERROR, category, message, data, error);
  }

  /**
   * CRITICAL уровень
   */
  critical(category: string, message: string, data?: Record<string, unknown>, error?: Error) {
    this.log(LogLevel.CRITICAL, category, message, data, error);
  }

  /**
   * Получить все логи
   */
  getLogs(filters?: {
    level?: LogLevel;
    category?: string;
    since?: number;
  }): LogEntry[] {
    let filtered = [...this.logs];

    if (filters?.level !== undefined) {
      filtered = filtered.filter((log) => log.level >= filters.level!);
    }

    if (filters?.category) {
      filtered = filtered.filter((log) => log.category === filters.category);
    }

    if (filters?.since) {
      filtered = filtered.filter((log) => log.timestamp >= filters.since!);
    }

    return filtered;
  }

  /**
   * Получить список категорий
   */
  getCategories(): string[] {
    return Array.from(this.categories);
  }

  /**
   * Очистить логи
   */
  clear() {
    this.logs = [];
  }

  /**
   * Alias для clear() (для обратной совместимости)
   */
  clearBuffer() {
    this.clear();
  }

  /**
   * Экспортировать логи в JSON
   */
  exportToJSON(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  /**
   * Экспортировать логи в текстовый файл
   */
  exportToText(): string {
    return this.logs
      .map((entry) => {
        const timestamp = new Date(entry.timestamp).toISOString();
        const level = LogLevel[entry.level].padEnd(8);
        const category = entry.category.padEnd(20);
        const dataStr = entry.data ? JSON.stringify(entry.data) : '';
        return `[${timestamp}] [${level}] [${category}] ${entry.message} ${dataStr}`;
      })
      .join('\n');
  }
}

// Singleton instance
export const logger = new Logger();

// ============================================
// КАТЕГОРИИ (константы для типизации)
// ============================================

export const LOG_CATEGORIES = {
  AUTH: 'Auth',
  API: 'API',
  WEBSOCKET: 'WebSocket',
  SYNC: 'Sync',
  MATCH: 'Match',
  BRACKET: 'Bracket',
  LOCAL_SERVER: 'LocalServer',
  DATABASE: 'Database',
  UI: 'UI',
  SYSTEM: 'System',
} as const;

// ============================================
// REACT HOOK
// ============================================

/**
 * Hook для использования логгера в React компонентах
 */
export function useLogger(category: string) {
  return {
    debug: (message: string, data?: Record<string, unknown>) =>
      logger.debug(category, message, data),
    info: (message: string, data?: Record<string, unknown>) =>
      logger.info(category, message, data),
    warn: (message: string, data?: Record<string, unknown>, error?: Error) =>
      logger.warn(category, message, data, error),
    error: (message: string, data?: Record<string, unknown>, error?: Error) =>
      logger.error(category, message, data, error),
    critical: (message: string, data?: Record<string, unknown>, error?: Error) =>
      logger.critical(category, message, data, error),
  };
}

// ============================================
// HELPERS
// ============================================

/**
 * Логировать performance метрики
 */
export function logPerformance(category: string, operation: string, duration: number) {
  logger.info(category, `${operation} completed`, {
    duration: `${duration}ms`,
    operation,
  });
}

/**
 * Замерить время выполнения функции
 */
export async function measureAsync<T>(
  category: string,
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const duration = performance.now() - start;
    logPerformance(category, operation, duration);
    return result;
  } catch (error) {
    const duration = performance.now() - start;
    logger.error(
      category,
      `${operation} failed after ${duration}ms`,
      { operation, duration: `${duration}ms` },
      error instanceof Error ? error : undefined
    );
    throw error;
  }
}

/**
 * Wrapper для функций с автоматическим логированием
 */
export function withLogging<T extends (...args: any[]) => any>(
  category: string,
  operation: string,
  fn: T
): T {
  return ((...args: Parameters<T>): ReturnType<T> => {
    logger.debug(category, `${operation} started`, { args });
    try {
      const result = fn(...args);
      logger.debug(category, `${operation} completed`);
      return result;
    } catch (error) {
      logger.error(
        category,
        `${operation} failed`,
        { args },
        error instanceof Error ? error : undefined
      );
      throw error;
    }
  }) as T;
}
