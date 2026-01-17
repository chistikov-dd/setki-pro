import { useServerModeStore } from '../../stores/serverModeStore';
import { useEffect, useState } from 'react';
import { checkUnsyncedCount, checkInternetConnection } from '../../services/api';

interface ConnectionStatusBannerProps {
  /** Показывать ли статус WebSocket подключения */
  wsConnected?: boolean;
}

/**
 * Глобальный sticky banner показывающий текущий режим работы и статус подключения
 *
 * Режимы:
 * - local-server: админ запустил локальный сервер
 * - local-client: судья подключен к локальному серверу
 */
export function ConnectionStatusBanner({ wsConnected }: ConnectionStatusBannerProps) {
  const { mode, serverUrl } = useServerModeStore();
  const [isOnline, setIsOnline] = useState(false);
  const [unsyncedCount, setUnsyncedCount] = useState<number>(0);

  // Проверяем реальный доступ к setki.pro API
  useEffect(() => {
    const checkInternet = async () => {
      try {
        const online = await checkInternetConnection();
        setIsOnline(online);
      } catch (error) {
        console.error('[ConnectionStatusBanner] Ошибка проверки интернета:', error);
        setIsOnline(false);
      }
    };

    // Проверяем сразу при монтировании
    checkInternet();

    // Повторяем каждые 30 секунд
    const interval = setInterval(checkInternet, 30000);

    return () => clearInterval(interval);
  }, []);

  // Периодически проверяем количество несинхронизированных записей
  useEffect(() => {
    const checkUnsynced = async () => {
      try {
        const count = await checkUnsyncedCount();
        setUnsyncedCount(count);
      } catch (error) {
        console.error('[ConnectionStatusBanner] Ошибка проверки несинхронизированных данных:', error);
      }
    };

    // Проверяем сразу
    checkUnsynced();

    // И потом каждые 10 секунд
    const interval = setInterval(checkUnsynced, 10000);

    return () => clearInterval(interval);
  }, []);

  // Определяем цвет и сообщение в зависимости от режима
  const getBannerConfig = () => {
    // Локальный сервер (админ)
    if (mode === 'local-server') {
      const internetStatus = isOnline ? '🌐 Интернет доступен' : '⚠️ Нет интернета';
      return {
        bg: isOnline ? 'bg-blue-600' : 'bg-yellow-600',
        icon: '🖥️',
        text: `Локальный сервер запущен | ${internetStatus}`,
      };
    }

    // Для судьи (local-client) баннер не показываем
    // if (mode === 'local-client' && serverUrl) {
    //   return null;
    // }

    return null;
  };

  const config = getBannerConfig();
  if (!config) return null;

  return (
    <div
      className={`sticky top-0 ${config.bg} text-white px-4 py-2 text-center text-sm font-medium z-50 shadow-md`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-center gap-4">
        <div>
          <span className="mr-2">{config.icon}</span>
          {config.text}
        </div>
        {unsyncedCount > 0 && (
          <div className="bg-white/20 px-3 py-1 rounded-full flex items-center gap-2">
            <span className="animate-pulse">⏳</span>
            <span className="text-xs font-semibold">
              {unsyncedCount} {unsyncedCount === 1 ? 'запись' : unsyncedCount < 5 ? 'записи' : 'записей'} не синхронизировано
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
