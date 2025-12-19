import { useEffect, useState } from 'react';
import { useServerModeStore } from '../stores/serverModeStore';
import { logger, LOG_CATEGORIES } from '../utils/logger';

export interface JudgeConnectedEvent {
  type: 'judge_connected';
  tournament_id: number;
  judge_name: string;
  table_number: number;
  user_id: number;
  timestamp: string;
}

export interface JudgeDisconnectedEvent {
  type: 'judge_disconnected';
  tournament_id: number;
  judge_name: string;
  table_number: number;
  user_id: number;
  timestamp: string;
}

export type AdminEvent = JudgeConnectedEvent | JudgeDisconnectedEvent;

interface UseAdminEventsWebSocketOptions {
  enabled?: boolean;
  onJudgeConnected?: (event: JudgeConnectedEvent) => void;
  onJudgeDisconnected?: (event: JudgeDisconnectedEvent) => void;
  onError?: (error: Error) => void;
}

/**
 * Hook для подключения к WebSocket административных событий
 * Используется админом для получения уведомлений о подключении/отключении судей
 *
 * @example
 * useAdminEventsWebSocket({
 *   enabled: true,
 *   onJudgeConnected: (event) => {
 *     showToast(`Судья ${event.judge_name} подключился к столу ${event.table_number}`, 'success');
 *   },
 *   onJudgeDisconnected: (event) => {
 *     showToast(`Судья ${event.judge_name} отключился от стола ${event.table_number}`, 'info');
 *   }
 * });
 */
export function useAdminEventsWebSocket({
  enabled = true,
  onJudgeConnected,
  onJudgeDisconnected,
  onError,
}: UseAdminEventsWebSocketOptions = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const { serverUrl, mode } = useServerModeStore();

  useEffect(() => {
    // Подключаемся только если enabled и режим local-server
    if (!enabled || mode !== 'local-server' || !serverUrl) {
      logger.debug(LOG_CATEGORIES.WEBSOCKET, 'Admin events WebSocket disabled', {
        enabled,
        mode,
        serverUrl,
      });
      return;
    }

    // Формируем WebSocket URL (ws:// вместо http://)
    const wsUrl = serverUrl.replace('http://', 'ws://') + '/ws/admin/events';

    logger.info(LOG_CATEGORIES.WEBSOCKET, 'Connecting to admin events WebSocket', { wsUrl });

    // Создаём WebSocket соединение
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setIsConnected(true);
      logger.info(LOG_CATEGORIES.WEBSOCKET, 'Admin events WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        const message: AdminEvent = JSON.parse(event.data);
        logger.debug(LOG_CATEGORIES.WEBSOCKET, 'Admin event received', { message });

        // Обработка события в зависимости от типа
        if (message.type === 'judge_connected' && onJudgeConnected) {
          onJudgeConnected(message as JudgeConnectedEvent);
        } else if (message.type === 'judge_disconnected' && onJudgeDisconnected) {
          onJudgeDisconnected(message as JudgeDisconnectedEvent);
        }
      } catch (error) {
        logger.error(
          LOG_CATEGORIES.WEBSOCKET,
          'Failed to parse admin event',
          { raw: event.data },
          error instanceof Error ? error : new Error(String(error))
        );
      }
    };

    ws.onerror = (event) => {
      const error = new Error('Admin WebSocket error');
      logger.error(LOG_CATEGORIES.WEBSOCKET, 'Admin events WebSocket error', {}, error);
      if (onError) {
        onError(error);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      logger.info(LOG_CATEGORIES.WEBSOCKET, 'Admin events WebSocket disconnected');
    };

    // Cleanup on unmount
    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };
  }, [enabled, mode, serverUrl, onJudgeConnected, onJudgeDisconnected, onError]);

  return {
    isConnected,
  };
}
