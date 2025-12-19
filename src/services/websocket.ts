import type {
  WSMessage,
  WSMessageType,
  WSScoreUpdateData,
  WSTimerUpdateData,
  WSMatchEndData,
} from '../types';
import { logger, LOG_CATEGORIES } from '../utils/logger';
import { ErrorFactory } from '../utils/errorHandler';

const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || 'wss://setki.pro/api/v1/ws/matches';

type MessageHandler = (message: WSMessage) => void;

/**
 * WebSocket клиент для real-time синхронизации матчей
 */
export class MatchWebSocket {
  private ws: WebSocket | null = null;
  private matchId: number;
  private pinCode?: string;
  private handlers: Map<WSMessageType, Set<MessageHandler>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private reconnectTimer: number | null = null;

  constructor(matchId: number, pinCode?: string) {
    this.matchId = matchId;
    this.pinCode = pinCode;
  }

  /**
   * Подключиться к WebSocket
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const url = this.pinCode
          ? `${WS_BASE_URL}/${this.matchId}?pin_code=${this.pinCode}`
          : `${WS_BASE_URL}/${this.matchId}`;

        logger.info(LOG_CATEGORIES.WEBSOCKET, 'Connecting to WebSocket', {
          matchId: this.matchId,
          url: url.replace(/pin_code=[^&]+/, 'pin_code=***'), // Hide PIN in logs
        });

        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          logger.info(LOG_CATEGORIES.WEBSOCKET, 'WebSocket connected successfully', {
            matchId: this.matchId,
            reconnectAttempts: this.reconnectAttempts,
          });
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: WSMessage = JSON.parse(event.data);
            logger.debug(LOG_CATEGORIES.WEBSOCKET, 'Received WebSocket message', {
              type: message.type,
              timestamp: message.timestamp,
            });
            this.handleMessage(message);
          } catch (error) {
            const appError = ErrorFactory.unknownError(error, { matchId: this.matchId });
            logger.error(
              LOG_CATEGORIES.WEBSOCKET,
              'Failed to parse WebSocket message',
              { rawData: event.data },
              appError
            );
          }
        };

        this.ws.onerror = () => {
          const appError = ErrorFactory.websocketError(
            'WebSocket connection error',
            { matchId: this.matchId }
          );
          logger.error(LOG_CATEGORIES.WEBSOCKET, 'WebSocket error occurred', {}, appError);
          reject(appError);
        };

        this.ws.onclose = (event) => {
          logger.warn(LOG_CATEGORIES.WEBSOCKET, 'WebSocket connection closed', {
            matchId: this.matchId,
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
          });
          this.attemptReconnect();
        };
      } catch (error) {
        const appError = ErrorFactory.websocketError(
          String(error),
          { matchId: this.matchId }
        );
        logger.error(LOG_CATEGORIES.WEBSOCKET, 'Failed to create WebSocket', {}, appError);
        reject(appError);
      }
    });
  }

  /**
   * Отключиться от WebSocket
   */
  disconnect() {
    logger.info(LOG_CATEGORIES.WEBSOCKET, 'Disconnecting WebSocket', {
      matchId: this.matchId,
    });

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.handlers.clear();
  }

  /**
   * Попытка переподключения с экспоненциальной задержкой
   */
  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error(
        LOG_CATEGORIES.WEBSOCKET,
        'Max reconnect attempts reached, giving up',
        {
          matchId: this.matchId,
          maxAttempts: this.maxReconnectAttempts,
        }
      );
      return;
    }

    // Экспоненциальная задержка: 1s, 2s, 4s, 8s, 16s
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    logger.info(LOG_CATEGORIES.WEBSOCKET, 'Scheduling reconnection attempt', {
      matchId: this.matchId,
      attempt: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
      delayMs: delay,
    });

    this.reconnectTimer = window.setTimeout(() => {
      logger.info(LOG_CATEGORIES.WEBSOCKET, 'Attempting to reconnect', {
        matchId: this.matchId,
        attempt: this.reconnectAttempts,
      });

      this.connect().catch((error) => {
        logger.error(
          LOG_CATEGORIES.WEBSOCKET,
          'Reconnection attempt failed',
          {
            matchId: this.matchId,
            attempt: this.reconnectAttempts,
          },
          error instanceof Error ? error : undefined
        );
      });
    }, delay);
  }

  /**
   * Обработать входящее сообщение
   */
  private handleMessage(message: WSMessage) {
    const handlers = this.handlers.get(message.type);
    if (handlers) {
      handlers.forEach((handler) => handler(message));
    }

    // Также вызываем общие обработчики
    const allHandlers = this.handlers.get('*' as WSMessageType);
    if (allHandlers) {
      allHandlers.forEach((handler) => handler(message));
    }
  }

  /**
   * Подписаться на сообщения определенного типа
   */
  on(type: WSMessageType | '*', handler: MessageHandler) {
    if (!this.handlers.has(type as WSMessageType)) {
      this.handlers.set(type as WSMessageType, new Set());
    }
    this.handlers.get(type as WSMessageType)!.add(handler);

    // Возвращаем функцию для отписки
    return () => {
      this.handlers.get(type as WSMessageType)?.delete(handler);
    };
  }

  /**
   * Отправить сообщение серверу
   */
  send<T = unknown>(type: WSMessageType, data?: T) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn(LOG_CATEGORIES.WEBSOCKET, 'Cannot send message: WebSocket not connected', {
        matchId: this.matchId,
        messageType: type,
        readyState: this.ws?.readyState,
      });
      return;
    }

    const message: WSMessage<T> = {
      type,
      data,
      timestamp: new Date().toISOString(),
    };

    try {
      this.ws.send(JSON.stringify(message));
      logger.debug(LOG_CATEGORIES.WEBSOCKET, 'Sent WebSocket message', {
        matchId: this.matchId,
        type,
      });
    } catch (error) {
      const appError = ErrorFactory.websocketError(
        String(error),
        { matchId: this.matchId, messageType: type }
      );
      logger.error(
        LOG_CATEGORIES.WEBSOCKET,
        'Failed to send WebSocket message',
        { type },
        appError
      );
    }
  }

  /**
   * Отправить обновление счета
   */
  sendScoreUpdate(data: WSScoreUpdateData) {
    this.send('score_update', data);
  }

  /**
   * Отправить обновление таймера
   */
  sendTimerUpdate(data: WSTimerUpdateData) {
    this.send('timer_update', data);
  }

  /**
   * Отправить начало матча
   */
  sendMatchStart() {
    this.send('match_start');
  }

  /**
   * Отправить завершение матча
   */
  sendMatchEnd(data: WSMatchEndData) {
    this.send('match_end', data);
  }

  /**
   * Отправить смену раунда
   */
  sendRoundChange(roundNumber: number) {
    this.send('round_change', { round_number: roundNumber });
  }

  /**
   * Проверить состояние подключения
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

/**
 * Создать WebSocket подключение к матчу
 */
export function createMatchWebSocket(matchId: number, pinCode?: string): MatchWebSocket {
  return new MatchWebSocket(matchId, pinCode);
}
