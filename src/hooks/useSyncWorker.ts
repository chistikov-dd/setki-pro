import { useEffect, useRef } from 'react';
import { retrySync, isRetryableError } from '../utils/retry';
import { logger, LOG_CATEGORIES } from '../utils/logger';
import { syncChanges, syncToLocalServer } from '../services/api';

interface UseSyncWorkerOptions {
  enabled?: boolean;
  interval?: number; // Интервал проверки в миллисекундах (по умолчанию 30 секунд)
  serverMode?: { mode: 'online' | 'local-server' | 'local-client'; serverUrl: string | null };
  onSyncStart?: () => void;
  onSyncSuccess?: (syncedCount: number) => void;
  onSyncError?: (error: Error) => void;
}

/**
 * Hook для background синхронизации с backend
 * Автоматически запускает sync_changes каждые N секунд
 *
 * @example
 * useSyncWorker({
 *   enabled: true,
 *   interval: 30000, // 30 секунд
 *   onSyncSuccess: (count) => console.log(`Synced ${count} changes`)
 * });
 */
export function useSyncWorker({
  enabled = true,
  interval = 30000,
  serverMode,
  onSyncStart,
  onSyncSuccess,
  onSyncError,
}: UseSyncWorkerOptions = {}) {
  const intervalRef = useRef<number | null>(null);
  const isSyncingRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      // Очищаем интервал если disabled
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const performSync = async () => {
      // Пропускаем если уже идёт синхронизация (debounce)
      if (isSyncingRef.current) {
        logger.debug(LOG_CATEGORIES.SYNC, 'Sync already in progress, skipping');
        return;
      }

      isSyncingRef.current = true;

      try {
        logger.info(LOG_CATEGORIES.SYNC, 'Starting background sync', {
          mode: serverMode?.mode || 'online',
        });
        onSyncStart?.();

        // Определяем какую функцию синхронизации использовать
        const syncFn = serverMode?.mode === 'local-client' && serverMode.serverUrl
          ? () => syncToLocalServer(serverMode.serverUrl!)
          : () => syncChanges();

        // Вызываем с retry logic
        await retrySync(syncFn, {
          shouldRetry: (error) => isRetryableError(error),
          onRetry: (error, attempt, nextDelay) => {
            logger.warn(
              LOG_CATEGORIES.SYNC,
              `Sync attempt ${attempt} failed, retrying in ${nextDelay}ms`,
              { error: String(error), attempt, nextDelay }
            );
          },
        });

        logger.info(LOG_CATEGORIES.SYNC, 'Sync completed successfully');
        onSyncSuccess?.(0); // Не знаем количество, передаем 0
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(LOG_CATEGORIES.SYNC, 'Sync failed after retries', {}, err);
        onSyncError?.(err);
      } finally {
        isSyncingRef.current = false;
      }
    };

    // Запускаем первую синхронизацию сразу
    performSync();

    // Затем запускаем периодически
    intervalRef.current = window.setInterval(performSync, interval);

    // Cleanup on unmount
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, interval, serverMode, onSyncStart, onSyncSuccess, onSyncError]);

  // Ручной запуск синхронизации
  const triggerSync = async () => {
    if (isSyncingRef.current) {
      logger.debug(LOG_CATEGORIES.SYNC, 'Manual sync requested but already in progress');
      return;
    }

    isSyncingRef.current = true;

    try {
      logger.info(LOG_CATEGORIES.SYNC, 'Manual sync triggered', {
        mode: serverMode?.mode || 'online',
      });
      onSyncStart?.();

      // Определяем какую функцию синхронизации использовать
      const syncFn = serverMode?.mode === 'local-client' && serverMode?.serverUrl
        ? () => syncToLocalServer(serverMode.serverUrl!)
        : () => syncChanges();

      await retrySync(syncFn, {
        shouldRetry: (error) => isRetryableError(error),
        onRetry: (error, attempt, nextDelay) => {
          logger.warn(
            LOG_CATEGORIES.SYNC,
            `Manual sync attempt ${attempt} failed, retrying in ${nextDelay}ms`,
            { error: String(error), attempt, nextDelay }
          );
        },
      });

      logger.info(LOG_CATEGORIES.SYNC, 'Manual sync completed successfully');
      onSyncSuccess?.(0);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(LOG_CATEGORIES.SYNC, 'Manual sync failed after retries', {}, err);
      onSyncError?.(err);
    } finally {
      isSyncingRef.current = false;
    }
  };

  return {
    triggerSync,
    isSyncing: isSyncingRef.current,
  };
}
