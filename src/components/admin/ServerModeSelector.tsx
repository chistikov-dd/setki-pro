import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '../ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Input } from '../ui/Input';

export type ServerMode = 'online' | 'local-server' | 'local-client';

interface ServerModeSelectorProps {
  currentMode: ServerMode;
  onModeChange: (mode: ServerMode) => void;
  onBack?: () => void;
  isJudgeMode?: boolean;
}

export function ServerModeSelector({ currentMode, onModeChange, onBack, isJudgeMode = false }: ServerModeSelectorProps) {
  const [localServerUrl, setLocalServerUrl] = useState<string>('');
  const [localClientIp, setLocalClientIp] = useState<string>('192.168.1.10');
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStartLocalServer = async () => {
    setIsStarting(true);
    setError(null);

    try {
      const url = await invoke<string>('start_local_server', { port: 8081 });
      setLocalServerUrl(url);
      onModeChange('local-server');
    } catch (err) {
      setError(err as string);
    } finally {
      setIsStarting(false);
    }
  };

  const handleConnectToLocal = async () => {
    setError(null);

    try {
      await invoke('set_api_base_url', { url: `http://${localClientIp}:8081/api/v1` });
      onModeChange('local-client');
    } catch (err) {
      setError(err as string);
    }
  };

  const handleSwitchToOnline = () => {
    onModeChange('online');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-white to-gray-100 p-4">
      <div className="w-full max-w-2xl">
        {/* Back button */}
        {onBack && (
          <button
            onClick={onBack}
            className="mb-6 flex items-center gap-2 text-gray-800 hover:text-gray-900 transition-colors group"
          >
            <svg className="w-5 h-5 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span>Назад</span>
          </button>
        )}

        <Card className="w-full">
          <CardHeader>
            <CardTitle className="text-2xl">Режим работы приложения</CardTitle>
          </CardHeader>

        <CardContent className="space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* Current mode indicator */}
          {currentMode !== 'online' && (
            <div className="bg-blue-500/10 border border-blue-500/50 rounded-lg p-4">
              <p className="text-blue-400 text-sm font-medium">
                Текущий режим:{' '}
                {currentMode === 'local-server' && 'Локальный сервер'}
                {currentMode === 'local-client' && 'Подключение к локальному серверу'}
              </p>
              {currentMode === 'local-server' && localServerUrl && (
                <p className="text-blue-300 text-xs mt-2">
                  Адрес сервера: <span className="font-mono">{localServerUrl}</span>
                </p>
              )}
            </div>
          )}

          {/* Mode options */}
          <div className="space-y-4">
            {/* Online mode */}
            {!isJudgeMode && (
              <div className="border border-gray-400 rounded-lg p-4 hover:border-gray-600 transition-colors">
                <h3 className="text-white font-semibold mb-2">Работа через интернет</h3>
                <p className="text-gray-800 text-sm mb-3">
                  Подключение к серверу setki.pro. Требуется стабильное интернет-соединение.
                </p>
                <Button
                  onClick={handleSwitchToOnline}
                  variant={currentMode === 'online' ? 'primary' : 'secondary'}
                  disabled={currentMode === 'online'}
                >
                  {currentMode === 'online' ? 'Активен' : 'Переключиться'}
                </Button>
              </div>
            )}

            {/* Local server mode */}
            {!isJudgeMode && (
              <div className="border border-gray-400 rounded-lg p-4 hover:border-gray-600 transition-colors">
              <h3 className="text-white font-semibold mb-2">Запустить локальный сервер</h3>
              <p className="text-gray-800 text-sm mb-3">
                Этот компьютер станет сервером для других судейских столов. Выберите этот режим на
                главном (админском) компьютере.
              </p>
              {currentMode === 'local-server' && localServerUrl ? (
                <div className="space-y-2">
                  <div className="bg-green-500/10 border border-green-500/50 rounded p-3">
                    <p className="text-green-400 text-sm font-medium mb-1">Сервер запущен!</p>
                    <p className="text-green-300 text-xs mb-2">
                      Судьи должны подключиться к адресу:
                    </p>
                    <code className="block bg-black/30 rounded px-3 py-2 text-green-400 font-mono text-sm">
                      {localServerUrl}
                    </code>
                  </div>
                </div>
              ) : (
                <Button
                  onClick={handleStartLocalServer}
                  variant="primary"
                  disabled={isStarting}
                >
                  {isStarting ? 'Запуск...' : 'Запустить сервер'}
                </Button>
              )}
              </div>
            )}

            {/* Local client mode */}
            <div className="border border-gray-400 rounded-lg p-4 hover:border-gray-600 transition-colors">
              <h3 className="text-white font-semibold mb-2">
                {isJudgeMode ? 'Подключение к локальному серверу' : 'Подключиться к локальному серверу'}
              </h3>
              <p className="text-gray-800 text-sm mb-3">
                {isJudgeMode
                  ? 'Введите IP-адрес локального сервера, который вам предоставил администратор турнира.'
                  : 'Подключение к локальному серверу на другом компьютере. Введите IP-адрес сервера.'
                }
              </p>
              <div className="space-y-3">
                <Input
                  label="IP адрес сервера"
                  value={localClientIp}
                  onChange={(e) => setLocalClientIp(e.target.value)}
                  placeholder="192.168.1.10"
                  disabled={currentMode === 'local-client'}
                />
                <Button
                  onClick={handleConnectToLocal}
                  variant={currentMode === 'local-client' ? 'primary' : 'secondary'}
                  disabled={currentMode === 'local-client' || !localClientIp}
                >
                  {currentMode === 'local-client' ? 'Подключено' : 'Подключиться'}
                </Button>
              </div>
            </div>
          </div>

          {/* Help text */}
          <div className="bg-white/50 rounded-lg p-4 border border-gray-400">
            <h4 className="text-white font-medium text-sm mb-2">Как использовать:</h4>
            <ul className="text-gray-800 text-xs space-y-1 list-disc list-inside">
              <li>
                <strong>Перед турниром (с интернетом):</strong> Админ выбирает "Работа через
                интернет", скачивает турнир
              </li>
              <li>
                <strong>На турнире (без интернета):</strong> Админ запускает локальный сервер,
                показывает IP судьям
              </li>
              <li>
                <strong>Судьи:</strong> Подключаются к локальному серверу по IP адресу
              </li>
              <li>
                <strong>После турнира:</strong> Админ переключается на онлайн, выгружает результаты
              </li>
            </ul>
          </div>
        </CardContent>
        </Card>
      </div>
    </div>
  );
}
