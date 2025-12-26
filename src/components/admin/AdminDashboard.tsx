import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useServerModeStore } from '../../stores/serverModeStore';
import { useSyncWorker } from '../../hooks/useSyncWorker';
import { downloadTournament, isTournamentDownloaded, clearTournamentCache } from '../../services/api';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/Dialog';
import { TournamentCard } from './TournamentCard';
import { ServerModeSelector } from './ServerModeSelector';
import { JudgeTablesMonitor } from './JudgeTablesMonitor';
import { ActiveMatchesMonitor } from './ActiveMatchesMonitor';
import { ActiveSessionsPanel } from './ActiveSessionsPanel';
import { SyncProgress } from './SyncProgress';
import { TournamentCardSkeleton, SkeletonList } from '../ui/Skeleton';
import { ToastContainer, Toast } from '../ui/Toast';
import { useToast } from '../../hooks/useToast';
import { useAdminEventsWebSocket } from '../../hooks/useAdminEventsWebSocket';
import type { ServerMode } from '../../stores/serverModeStore';

export const AdminDashboard = () => {
  const { user, logout } = useAuthStore();
  const {
    tournaments,
    currentSession,
    isLoading,
    error,
    loadTournaments,
    loadTournamentSession,
    clearSession,
    clearError,
  } = useSessionStore();
  const { mode: serverMode, setMode: setServerMode } = useServerModeStore();

  const [selectedTournamentId, setSelectedTournamentId] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState('');
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [showServerModeDialog, setShowServerModeDialog] = useState(false);
  const [isTournamentCached, setIsTournamentCached] = useState(false);
  const [showClearCacheDialog, setShowClearCacheDialog] = useState(false);

  // Toast уведомления
  const { toasts, showToast, hideToast } = useToast();

  // Стабильный serverMode объект для useSyncWorker
  const serverModeConfig = useMemo(() => ({
    mode: serverMode,
    serverUrl: null
  }), [serverMode]);

  // Стабильные callbacks для useSyncWorker
  const handleSyncSuccess = useCallback(() => {
    console.log('[AdminDashboard] Background sync успешна');
  }, []);

  const handleSyncError = useCallback((error: Error) => {
    console.error('[AdminDashboard] Background sync ошибка:', error);
  }, []);

  // Background синхронизация при старте приложения и каждые 30 секунд
  useSyncWorker({
    enabled: serverMode === 'online', // Только в online режиме (в local-server данные уже на этом компьютере)
    interval: 30000,
    serverMode: serverModeConfig,
    onSyncSuccess: handleSyncSuccess,
    onSyncError: handleSyncError,
  });

  // WebSocket для административных событий (подключение/отключение судей)
  useAdminEventsWebSocket({
    enabled: serverMode === 'local-server',
    onJudgeConnected: (event) => {
      showToast(
        `Судья ${event.judge_name} подключился к столу №${event.table_number}`,
        'success',
        5000
      );
    },
    onJudgeDisconnected: (event) => {
      showToast(
        `Судья ${event.judge_name} отключился от стола №${event.table_number}`,
        'info',
        5000
      );
    },
    onError: () => {
      showToast('Ошибка WebSocket соединения с сервером', 'error', 3000);
    },
  });

  // Загрузить турниры при монтировании
  useEffect(() => {
    loadTournaments()
      .then(() => {
        // Успешная загрузка - очистить ошибку если была
        if (error) {
          clearError();
        }
      })
      .catch(() => {
        // Ошибка уже установлена в store
      });
  }, [loadTournaments, error, clearError]);

  // Проверить, скачан ли текущий турнир
  useEffect(() => {
    if (currentSession) {
      isTournamentDownloaded(currentSession.tournament_id)
        .then(setIsTournamentCached)
        .catch(() => setIsTournamentCached(false));
    }
  }, [currentSession]);

  // Загрузить турнир для работы
  const handleLoadTournament = async () => {
    if (!selectedTournamentId) {
      setSuccessMessage('Выберите турнир');
      setShowSuccessDialog(true);
      return;
    }

    try {
      await loadTournamentSession(selectedTournamentId);
      // Убрано уведомление "Турнир загружен успешно!" - турнир загружается без модального окна
    } catch (error) {
      console.error('Ошибка загрузки турнира:', error);
    }
  };

  // Скачать данные турнира для offline
  const handleDownloadTournament = async () => {
    if (!currentSession) {
      setSuccessMessage('Сначала загрузите турнир');
      setShowSuccessDialog(true);
      return;
    }

    const bracketsCount = currentSession.brackets?.length || 0;

    setIsDownloading(true);
    setDownloadProgress(`Загрузка ${bracketsCount} сеток и всех матчей (1 запрос)... Подождите 5-10 секунд.`);

    try {
      await downloadTournament(currentSession.tournament_id);
      setDownloadProgress('');
      setIsDownloading(false);
      // Обновить статус кэша
      setIsTournamentCached(true);
    } catch (error) {
      console.error('Ошибка скачивания:', error);
      setDownloadProgress('Ошибка загрузки данных');
      setIsDownloading(false);
    }
  };

  // Очистить кеш турнира
  const handleClearCacheClick = () => {
    if (!currentSession) {
      setSuccessMessage('Сначала загрузите турнир');
      setShowSuccessDialog(true);
      return;
    }
    setShowClearCacheDialog(true);
  };

  const confirmClearCache = async () => {
    setShowClearCacheDialog(false);

    if (!currentSession) return;

    try {
      await clearTournamentCache(currentSession.tournament_id);
      setIsTournamentCached(false);
      showToast('Кеш турнира успешно очищен', 'success', 3000);
    } catch (error) {
      console.error('Ошибка очистки кеша:', error);
      showToast('Ошибка очистки кеша', 'error', 3000);
    }
  };

  // Выход
  const handleLogout = () => {
    setShowLogoutDialog(true);
  };

  const confirmLogout = () => {
    logout();
    setShowLogoutDialog(false);
  };

  const handleServerModeChange = (mode: ServerMode) => {
    setServerMode(mode);
    setShowServerModeDialog(false);
    setSuccessMessage(`Режим изменен на: ${mode === 'online' ? 'Онлайн' : mode === 'local-server' ? 'Локальный сервер' : 'Подключение к серверу'}`);
    setShowSuccessDialog(true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2">
              Панель администратора
            </h1>
            <p className="text-gray-800">
              ID: {user?.user_id} | Режим: {serverMode === 'online' ? 'Онлайн' : serverMode === 'local-server' ? 'Локальный сервер' : 'Клиент'}
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setShowServerModeDialog(true)}>
              Режим работы
            </Button>
            <Button variant="secondary" onClick={handleLogout}>
              Выйти
            </Button>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <Card variant="bordered" className="mb-6 bg-red-50 border-red-300">
            <CardContent>
              <div className="flex justify-between items-center">
                <p className="text-red-700">{error}</p>
                <Button variant="ghost" size="sm" onClick={clearError}>
                  Закрыть
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Current Tournament Display */}
        {currentSession ? (
          <div className="mb-8">
            <Card variant="elevated">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Текущий турнир</CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      clearSession();
                      setIsTournamentCached(false);
                    }}
                    className="flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Назад
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h3 className="text-2xl font-bold text-gray-900 mb-2">
                      {currentSession.tournament.title || `Турнир #${currentSession.tournament_id}`}
                    </h3>
                  </div>

                  {/* PIN-код */}
                  <div className="bg-gray-100 rounded-lg p-6 text-center border border-gray-400">
                    <p className="text-sm text-gray-800 mb-2">PIN-код для судей:</p>
                    <p className="text-6xl font-mono font-bold text-green-600 tracking-widest">
                      {currentSession.pin_code}
                    </p>
                  </div>

                  {/* Download Status & Button */}
                  {isTournamentCached && (
                    <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-4 py-3 rounded-lg border border-emerald-200">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="font-medium">Данные загружены для offline работы</span>
                    </div>
                  )}

                  <div className="flex gap-4">
                    <Button
                      variant="primary"
                      onClick={handleDownloadTournament}
                      disabled={isDownloading}
                      className="flex-1"
                    >
                      {isDownloading ? 'Загрузка...' : isTournamentCached ? 'Обновить данные' : 'Скачать данные для offline'}
                    </Button>
                    {isTournamentCached && (
                      <Button
                        variant="ghost"
                        onClick={handleClearCacheClick}
                        disabled={isDownloading}
                        className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
                      >
                        Очистить кеш
                      </Button>
                    )}
                  </div>

                  {downloadProgress && (
                    <p className="text-center text-blue-600">{downloadProgress}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          /* Load Tournament Form */
          <div className="mb-8">
            <Card variant="bordered">
              <CardHeader>
                <CardTitle>Выбрать турнир для работы</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-800 mb-4">Загрузка турниров...</p>
                    <SkeletonList
                      count={3}
                      itemComponent={TournamentCardSkeleton}
                      className="grid grid-cols-1 gap-4"
                    />
                  </div>
                ) : tournaments.length === 0 ? (
                  <p className="text-gray-800 text-center py-4">
                    Нет доступных турниров
                  </p>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-800 mb-4">
                      Выберите турнир для начала работы:
                    </p>

                    {/* Tournament Cards Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-h-96 overflow-y-auto">
                      {tournaments.map((tournament) => (
                        <TournamentCard
                          key={tournament.id}
                          tournament={tournament}
                          isSelected={selectedTournamentId === tournament.id}
                          onClick={() => setSelectedTournamentId(tournament.id)}
                        />
                      ))}
                    </div>

                    <Button
                      variant="primary"
                      onClick={handleLoadTournament}
                      disabled={!selectedTournamentId || isLoading}
                      fullWidth
                      size="lg"
                    >
                      Загрузить выбранный турнир
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Monitoring Section */}
        {currentSession && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Judge Tables Monitor */}
            <JudgeTablesMonitor
              tournamentId={currentSession.tournament_id}
            />

            {/* Active Matches Monitor */}
            <ActiveMatchesMonitor
              tournamentId={currentSession.tournament_id}
              autoRefresh={true}
              refreshInterval={3000}
            />
          </div>
        )}

        {/* Active Sessions Panel - Управление столами */}
        {currentSession && (
          <div className="mb-8">
            <ActiveSessionsPanel />
          </div>
        )}

        {/* Sync Section */}
        {currentSession && (
          <div className="mb-8">
            <SyncProgress tournamentId={currentSession.tournament_id} />
          </div>
        )}
      </div>

      {/* Logout Confirmation Dialog */}
      <Dialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Выход из аккаунта</DialogTitle>
            <DialogDescription>
              Вы уверены, что хотите выйти из аккаунта?
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 mt-6">
            <Button
              variant="secondary"
              onClick={() => setShowLogoutDialog(false)}
              fullWidth
            >
              Отмена
            </Button>
            <Button
              variant="danger"
              onClick={confirmLogout}
              fullWidth
            >
              Выйти
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Clear Cache Confirmation Dialog */}
      <Dialog open={showClearCacheDialog} onOpenChange={setShowClearCacheDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Очистить кеш турнира?</DialogTitle>
            <DialogDescription>
              Это действие удалит все загруженные данные турнира (сетки, матчи).
              Потребуется повторная загрузка для offline работы.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 mt-6">
            <Button
              variant="secondary"
              onClick={() => setShowClearCacheDialog(false)}
              fullWidth
            >
              Отмена
            </Button>
            <Button
              variant="danger"
              onClick={confirmClearCache}
              fullWidth
            >
              Очистить
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Success/Info Dialog */}
      <Dialog open={showSuccessDialog} onOpenChange={setShowSuccessDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {successMessage.includes('успешно') ? '✓ Успешно' : 'Информация'}
            </DialogTitle>
            <DialogDescription>
              {successMessage}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 mt-6">
            <Button
              variant="primary"
              onClick={() => setShowSuccessDialog(false)}
              fullWidth
            >
              Закрыть
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Server Mode Dialog */}
      <Dialog open={showServerModeDialog} onOpenChange={setShowServerModeDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0">
          <ServerModeSelector
            currentMode={serverMode}
            onModeChange={handleServerModeChange}
          />
        </DialogContent>
      </Dialog>

      {/* Toast Notifications */}
      <ToastContainer>
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            duration={toast.duration}
            onClose={() => hideToast(toast.id)}
          />
        ))}
      </ToastContainer>
    </div>
  );
};
