import { invoke } from '@tauri-apps/api/core';

/**
 * Файловый логгер для записи в ~/.setki-keeper/data/setki.log
 * Используется для отладки синхронизации и других проблем
 */
class FileLogger {
  private async log(level: 'info' | 'debug' | 'warn' | 'error', message: string) {
    try {
      await invoke('log_to_file', { level, message });
    } catch (error) {
      // Fallback на консоль если файловое логирование недоступно
      console.error('[FileLogger] Failed to write to file:', error);
    }
  }

  info(message: string, data?: any) {
    const logMessage = data ? `${message} ${JSON.stringify(data)}` : message;
    console.log(`[INFO] ${logMessage}`);
    this.log('info', logMessage);
  }

  debug(message: string, data?: any) {
    const logMessage = data ? `${message} ${JSON.stringify(data)}` : message;
    console.log(`[DEBUG] ${logMessage}`);
    this.log('debug', logMessage);
  }

  warn(message: string, data?: any) {
    const logMessage = data ? `${message} ${JSON.stringify(data)}` : message;
    console.warn(`[WARN] ${logMessage}`);
    this.log('warn', logMessage);
  }

  error(message: string, data?: any) {
    const logMessage = data ? `${message} ${JSON.stringify(data)}` : message;
    console.error(`[ERROR] ${logMessage}`);
    this.log('error', logMessage);
  }
}

export const fileLogger = new FileLogger();
