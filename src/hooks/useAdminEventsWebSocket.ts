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

export interface AdminCalledEvent {
  type: 'admin_called';
  table_number: number;
  judge_name: string | null;
  message: string | null;
  timestamp: string;
}

export type AdminEvent = JudgeConnectedEvent | JudgeDisconnectedEvent | AdminCalledEvent;

interface UseAdminEventsWebSocketOptions {
  enabled?: boolean;
  onJudgeConnected?: (event: JudgeConnectedEvent) => void;
  onJudgeDisconnected?: (event: JudgeDisconnectedEvent) => void;
  onAdminCalled?: (event: AdminCalledEvent) => void;
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
  onAdminCalled,
  onError,
}: UseAdminEventsWebSocketOptions = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const { mode } = useServerModeStore();
  const { addJudge, removeJudge } = useJudgeMonitorStore();

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const destroyedRef = useRef(false);

  const onJudgeConnectedRef = useRef(onJudgeConnected);
  const onJudgeDisconnectedRef = useRef(onJudgeDisconnected);
  const onAdminCalledRef = useRef(onAdminCalled);
  const onErrorRef = useRef(onError);

  // Обновляем refs при изменении callbacks
  useEffect(() => {
    onJudgeConnectedRef.current = onJudgeConnected;
    onJudgeDisconnectedRef.current = onJudgeDisconnected;
    onAdminCalledRef.current = onAdminCalled;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    // Подключаемся только если enabled и режим local-server
    if (!enabled || mode !== 'local-server') {
      logger.debug(LOG_CATEGORIES.WEBSOCKET, 'Admin events WebSocket disabled', {
        enabled,
        mode,
      });
      return;
    }

    destroyedRef.current = false;
    reconnectAttemptsRef.current = 0;

    const connectWebSocket = async () => {
      if (destroyedRef.current) return;

      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const token = await invoke<string | null>('get_token');
        const localServerUrl = await invoke<string | null>('get_local_server_url');

        if (!localServerUrl) {
          logger.warn(LOG_CATEGORIES.WEBSOCKET, 'Local server not running', {});
          scheduleReconnect();
          return;
        }

        let wsUrl = localServerUrl.replace('http://', 'ws://') + '/api/v1/ws/admin/events';

        if (token) {
          wsUrl += `?token=${encodeURIComponent(token)}`;
          logger.info(LOG_CATEGORIES.WEBSOCKET, 'Connecting to admin events WebSocket with token', {
            url: wsUrl.replace(/token=[^&]+/, 'token=***'),
            hasToken: true
          });
        } else {
          logger.warn(LOG_CATEGORIES.WEBSOCKET, 'No token found for admin WebSocket', { wsUrl });
        }

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (destroyedRef.current) { ws.close(); return; }
          reconnectAttemptsRef.current = 0;
          setIsConnected(true);
          logger.info(LOG_CATEGORIES.WEBSOCKET, 'Admin events WebSocket connected');
        };

        ws.onmessage = (event) => {
          try {
            const message: AdminEvent = JSON.parse(event.data);
            logger.debug(LOG_CATEGORIES.WEBSOCKET, 'Admin event received', { message });

            if (message.type === 'judge_connected') {
              const judgeEvent = message as JudgeConnectedEvent;
              addJudge({
                user_id: judgeEvent.user_id,
                judge_name: judgeEvent.judge_name,
                table_number: judgeEvent.table_number,
                tournament_id: judgeEvent.tournament_id,
                connected_at: judgeEvent.timestamp,
              });
              if (onJudgeConnectedRef.current) {
                onJudgeConnectedRef.current(judgeEvent);
              }
            } else if (message.type === 'judge_disconnected') {
              const judgeEvent = message as JudgeDisconnectedEvent;
              removeJudge(judgeEvent.table_number);
              if (onJudgeDisconnectedRef.current) {
                onJudgeDisconnectedRef.current(judgeEvent);
              }
            } else if (message.type === 'admin_called') {
              if (onAdminCalledRef.current) {
                onAdminCalledRef.current(message as AdminCalledEvent);
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

        ws.onerror = () => {
          const error = new Error('Admin WebSocket error');
          logger.error(LOG_CATEGORIES.WEBSOCKET, 'Admin events WebSocket error', {}, error);
          // Не вызываем onError при реконнекте чтобы не спамить toast
          if (reconnectAttemptsRef.current === 0 && onErrorRef.current) {
            onErrorRef.current(error);
          }
        };

        ws.onclose = () => {
          setIsConnected(false);
          logger.info(LOG_CATEGORIES.WEBSOCKET, 'Admin events WebSocket disconnected');
          scheduleReconnect();
        };
      } catch (error) {
        logger.error(
          LOG_CATEGORIES.WEBSOCKET,
          'Failed to connect admin WebSocket',
          {},
          error instanceof Error ? error : new Error(String(error))
        );
        scheduleReconnect();
      }
    };

    const scheduleReconnect = () => {
      if (destroyedRef.current) return;
      const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
      reconnectAttemptsRef.current += 1;
      logger.debug(LOG_CATEGORIES.WEBSOCKET, `Admin WebSocket reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);
      reconnectTimerRef.current = setTimeout(connectWebSocket, delay);
    };

    connectWebSocket();

    // Cleanup on unmount
    return () => {
      destroyedRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current &&
          (wsRef.current.readyState === WebSocket.OPEN ||
           wsRef.current.readyState === WebSocket.CONNECTING)) {
        logger.debug(LOG_CATEGORIES.WEBSOCKET, 'Closing admin WebSocket on cleanup');
        wsRef.current.close();
      }
      wsRef.current = null;
    };
  }, [enabled, mode, addJudge, removeJudge]);

  return {
    isConnected,
  };
}
