import { useEffect, useRef, useState } from 'react';
import { createMatchWebSocket, type MatchWebSocket } from '../services/websocket';
import type { WSScoreUpdateData } from '../types';

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

  useEffect(() => {
    if (!autoConnect) return;

    // Create WebSocket instance
    const ws = createMatchWebSocket(matchId, pinCode);
    wsRef.current = ws;

    // Subscribe to events
    const unsubscribers: Array<() => void> = [];

    if (onScoreUpdate) {
      unsubscribers.push(
        ws.on('score_update', (message) => {
          if (message.data) {
            onScoreUpdate(message.data as WSScoreUpdateData);
          }
        })
      );
    }

    if (onMatchStart) {
      unsubscribers.push(
        ws.on('match_start', () => {
          onMatchStart();
        })
      );
    }

    if (onMatchEnd) {
      unsubscribers.push(
        ws.on('match_end', () => {
          onMatchEnd();
        })
      );
    }

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
  }, [matchId, pinCode, autoConnect, onScoreUpdate, onMatchStart, onMatchEnd]);

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
