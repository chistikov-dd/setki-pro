import { useEffect, useState, useRef } from 'react';
import { useServerModeStore } from '../stores/serverModeStore';
import { useJudgeMonitorStore } from '../stores/judgeMonitorStore';
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
  const { addJudge, removeJudge } = useJudgeMonitorStore();

  // FIX: Используем useRef для WebSocket вместо let переменной
  // Это решает race condition когда cleanup вызывается до завершения connectWebSocket
  const wsRef = useRef<WebSocket | null>(null);

  // FIX: Используем useRef для callbacks чтобы избежать reconnect при изменении callback функций
  const onJudgeConnectedRef = useRef(onJudgeConnected);
  const onJudgeDisconnectedRef = useRef(onJudgeDisconnected);
  const onErrorRef = useRef(onError);

  // Обновляем refs при изменении callbacks
  useEffect(() => {
    onJudgeConnectedRef.current = onJudgeConnected;
    onJudgeDisconnectedRef.current = onJudgeDisconnected;
    onErrorRef.current = onError;
  });

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

    // Получаем токен и подключаемся к WebSocket
    const connectWebSocket = async () => {
      try {
        // Получаем токен из базы данных через Tauri API
        const { invoke } = await import('@tauri-apps/api/core');
        const token = await invoke<string | null>('get_token');

        // Формируем WebSocket URL (ws:// вместо http://)
        let wsUrl = serverUrl.replace('http://', 'ws://') + '/ws/admin/events';

        // Добавляем токен в query параметр
        if (token) {
          wsUrl += `?token=${encodeURIComponent(token)}`;
          logger.info(LOG_CATEGORIES.WEBSOCKET, 'Connecting to admin events WebSocket with token', {
            url: wsUrl.replace(/token=[^&]+/, 'token=***'),
            hasToken: true
          });
        } else {
          logger.warn(LOG_CATEGORIES.WEBSOCKET, 'No token found for admin WebSocket', { wsUrl });
        }

        // Создаём WebSocket соединение
        const ws = new WebSocket(wsUrl);

        return ws;
      } catch (error) {
        logger.error(
          LOG_CATEGORIES.WEBSOCKET,
          'Failed to get token for admin WebSocket',
          {},
          error instanceof Error ? error : new Error(String(error))
        );
        return null;
      }
    };

    connectWebSocket().then((socket) => {
      if (!socket) return;

      // Сохраняем WebSocket в ref
      wsRef.current = socket;

      socket.onopen = () => {
        setIsConnected(true);
        logger.info(LOG_CATEGORIES.WEBSOCKET, 'Admin events WebSocket connected');
      };

      socket.onmessage = (event) => {
        try {
          const message: AdminEvent = JSON.parse(event.data);
          logger.debug(LOG_CATEGORIES.WEBSOCKET, 'Admin event received', { message });

          // Обработка события в зависимости от типа
          if (message.type === 'judge_connected') {
            const judgeEvent = message as JudgeConnectedEvent;

            // Обновляем store с информацией о подключенном судье
            addJudge({
              user_id: judgeEvent.user_id,
              judge_name: judgeEvent.judge_name,
              table_number: judgeEvent.table_number,
              tournament_id: judgeEvent.tournament_id,
              connected_at: judgeEvent.timestamp,
            });

            // Вызываем callback если есть (используем ref)
            if (onJudgeConnectedRef.current) {
              onJudgeConnectedRef.current(judgeEvent);
            }
          } else if (message.type === 'judge_disconnected') {
            const judgeEvent = message as JudgeDisconnectedEvent;

            // Удаляем судью из store
            removeJudge(judgeEvent.table_number);

            // Вызываем callback если есть (используем ref)
            if (onJudgeDisconnectedRef.current) {
              onJudgeDisconnectedRef.current(judgeEvent);
            }
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

      socket.onerror = () => {
        const error = new Error('Admin WebSocket error');
        logger.error(LOG_CATEGORIES.WEBSOCKET, 'Admin events WebSocket error', {}, error);
        if (onErrorRef.current) {
          onErrorRef.current(error);
        }
      };

      socket.onclose = () => {
        setIsConnected(false);
        logger.info(LOG_CATEGORIES.WEBSOCKET, 'Admin events WebSocket disconnected');
      };
    });

    // Cleanup on unmount
    return () => {
      if (wsRef.current &&
          (wsRef.current.readyState === WebSocket.OPEN ||
           wsRef.current.readyState === WebSocket.CONNECTING)) {
        logger.debug(LOG_CATEGORIES.WEBSOCKET, 'Closing admin WebSocket on cleanup');
        wsRef.current.close();
      }
      wsRef.current = null;
    };
  }, [enabled, mode, serverUrl, addJudge, removeJudge]); // Убрали callbacks из deps

  return {
    isConnected,
  };
}
