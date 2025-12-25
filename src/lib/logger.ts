import { invoke } from '@tauri-apps/api/core';

/**
 * Frontend logger для записи логов в файл через Tauri backend
 */
export const logger = {
  info: async (message: string) => {
    try {
      await invoke('log_to_file', { level: 'info', message });
    } catch (e) {
      console.error('Failed to log:', e);
    }
  },

  debug: async (message: string) => {
    try {
      await invoke('log_to_file', { level: 'debug', message });
    } catch (e) {
      console.error('Failed to log:', e);
    }
  },

  warn: async (message: string) => {
    try {
      await invoke('log_to_file', { level: 'warn', message });
    } catch (e) {
      console.error('Failed to log:', e);
    }
  },

  error: async (message: string) => {
    try {
      await invoke('log_to_file', { level: 'error', message });
    } catch (e) {
      console.error('Failed to log:', e);
    }
  },
};
