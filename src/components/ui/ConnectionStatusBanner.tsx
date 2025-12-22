import { useServerModeStore } from '../../stores/serverModeStore';
import { useEffect, useState } from 'react';
import { checkUnsyncedCount } from '../../services/api';

interface ConnectionStatusBannerProps {
  /** Показывать ли статус WebSocket подключения */
  wsConnected?: boolean;
  /** Показывать всегда или только в offline режимах */
  alwaysShow?: boolean;
}

/**
 * Глобальный sticky banner показывающий текущий режим работы и статус подключения
 *
 * Режимы:
 * - online: работа через интернет с setki.pro
 * - local-server: админ запустил локальный сервер
 * - local-client: судья подключен к локальному серверу
 */
export function ConnectionStatusBanner({ wsConnected, alwaysShow = false }: ConnectionStatusBannerProps) {
  const { mode, serverUrl } = useServerModeStore();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [unsyncedCount, setUnsyncedCount] = useState<number>(0);

  // Отслеживаем статус интернет-подключения
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
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

  // Не показываем banner в online режиме если alwaysShow=false
  if (!alwaysShow && mode === 'online' && isOnline) {
    return null;
  }

  // Определяем цвет и сообщение в зависимости от режима
  const getBannerConfig = () => {
    // Критично: нет интернета
    if (!isOnline && mode === 'online') {
      return {
        bg: 'bg-red-600',
        icon: '⚠️',
        text: 'Нет интернета - данные сохраняются локально',
      };
    }

    // Локальный сервер (админ)
    if (mode === 'local-server') {
      return {
        bg: 'bg-blue-600',
        icon: '🖥️',
        text: 'Локальный сервер запущен - турнир в offline режиме',
      };
    }

    // Подключен к локальному серверу (судья)
    if (mode === 'local-client' && serverUrl) {
      const wsStatus = wsConnected !== undefined
        ? (wsConnected ? '✅ Связь активна' : '❌ Нет связи')
        : '';

      return {
        bg: wsConnected === false ? 'bg-yellow-600' : 'bg-green-600',
        icon: '🔌',
        text: `Локальный режим: ${serverUrl} ${wsStatus}`,
      };
    }

    // Онлайн режим с интернетом
    if (mode === 'online' && isOnline) {
      return {
        bg: 'bg-green-600',
        icon: '🌐',
        text: 'Работа через интернет - setki.pro',
      };
    }

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
