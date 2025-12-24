import { useEffect, useRef, useState } from 'react';
import { createMatchWebSocket, type MatchWebSocket } from '../services/websocket';
import type { WSScoreUpdateData } from '../types';
import { useServerModeStore } from '../stores/serverModeStore';

interface UseMatchWebSocketOptions {
  matchId: number;
  pinCode?: string;
  autoConnect?: boolean;
  onScoreUpdate?: (data: WSScoreUpdateData) => void;
  onMatchStart?: () => void;
  onMatchEnd?: () => void;
}

/**
 * Hook для WebSocket подключения к матчу
 * Автоматически подключается/отключается при mount/unmount
 *
 * @example
 * const { isConnected, sendScoreUpdate } = useMatchWebSocket({
 *   matchId: match.id,
 *   pinCode: 'ABC123',
 *   onScoreUpdate: (data) => {
 *     console.log('Score update from another table:', data);
 *   }
 * });
 */
export function useMatchWebSocket({
  matchId,
  pinCode,
  autoConnect = true,
  onScoreUpdate,
  onMatchStart,
  onMatchEnd,
}: UseMatchWebSocketOptions) {
  const wsRef = useRef<MatchWebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Используем refs для колбэков, чтобы они не вызывали пересоздание WebSocket
  const onScoreUpdateRef = useRef(onScoreUpdate);
  const onMatchStartRef = useRef(onMatchStart);
  const onMatchEndRef = useRef(onMatchEnd);

  // Обновляем refs при изменении колбэков
  useEffect(() => {
    onScoreUpdateRef.current = onScoreUpdate;
    onMatchStartRef.current = onMatchStart;
    onMatchEndRef.current = onMatchEnd;
  }, [onScoreUpdate, onMatchStart, onMatchEnd]);

  useEffect(() => {
    if (!autoConnect) return;

    // Получаем текущий режим и serverUrl из store
    const { mode, serverUrl } = useServerModeStore.getState();

    // Формируем WebSocket URL для локального сервера
    let wsUrl: string | undefined;
    if (mode === 'local-client' && serverUrl) {
      // Конвертируем HTTP URL в WebSocket URL
      const httpUrl = serverUrl.replace(/^https?:\/\//, ''); // убираем http(s)://
      wsUrl = `ws://${httpUrl}/api/v1/ws/matches`;
      console.log('[useMatchWebSocket] Using local server WebSocket:', wsUrl);
    } else {
      console.log('[useMatchWebSocket] Using default WebSocket (setki.pro)');
    }

    // Create WebSocket instance с кастомным URL если нужно
    const ws = createMatchWebSocket(matchId, pinCode, wsUrl);
    wsRef.current = ws;

    // Subscribe to events
    const unsubscribers: Array<() => void> = [];

    unsubscribers.push(
      ws.on('score_update', (message) => {
        if (message.data && onScoreUpdateRef.current) {
          onScoreUpdateRef.current(message.data as WSScoreUpdateData);
        }
      })
    );

    unsubscribers.push(
      ws.on('match_start', () => {
        if (onMatchStartRef.current) {
          onMatchStartRef.current();
        }
      })
    );

    unsubscribers.push(
      ws.on('match_end', () => {
        if (onMatchEndRef.current) {
          onMatchEndRef.current();
        }
      })
    );

    // Connect
    ws.connect()
      .then(() => {
        setIsConnected(true);
        setError(null);
        console.log('[useMatchWebSocket] Connected to match:', matchId);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to connect');
        setIsConnected(false);
        console.error('[useMatchWebSocket] Connection failed:', err);
      });

    // Cleanup on unmount
    return () => {
      console.log('[useMatchWebSocket] Disconnecting from match:', matchId);
      unsubscribers.forEach((unsub) => unsub());
      ws.disconnect();
      setIsConnected(false);
    };
  }, [matchId, pinCode, autoConnect]); // Убрали колбэки из зависимостей!

  return {
    isConnected,
    error,
    sendScoreUpdate: (data: WSScoreUpdateData) => wsRef.current?.sendScoreUpdate(data),
    sendTimerUpdate: (remainingSeconds: number, isRunning: boolean) =>
      wsRef.current?.sendTimerUpdate({ remaining_seconds: remainingSeconds, is_running: isRunning }),
    sendMatchStart: () => wsRef.current?.sendMatchStart(),
    sendMatchEnd: (winnerId?: number, resultType?: 'points' | 'submission' | 'disqualification') =>
      wsRef.current?.sendMatchEnd({ winner_id: winnerId, result_type: resultType }),
  };
}
