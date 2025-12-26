import { useState, useEffect, lazy, Suspense } from "react";
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { invoke } from '@tauri-apps/api/core';
import { LoginChoice } from "./components/auth/LoginChoice";
import { useAuthStore } from "./stores/authStore";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { ConnectionStatusBanner } from "./components/ui/ConnectionStatusBanner";
import { getSavedCredentials, getSavedJudgeCredentials, checkUnsyncedCount } from "./services/api";

// Lazy load тяжелых компонентов для уменьшения initial bundle size
// Оптимизация: основные компоненты загружаются только при необходимости
const AdminLogin = lazy(() => import("./components/auth/AdminLogin").then(m => ({ default: m.AdminLogin })));
const JudgeLogin = lazy(() => import("./components/auth/JudgeLogin").then(m => ({ default: m.JudgeLogin })));
const AdminDashboard = lazy(() => import("./components/admin/AdminDashboard").then(m => ({ default: m.AdminDashboard })));
const JudgeDashboard = lazy(() => import("./components/judge/JudgeDashboard").then(m => ({ default: m.JudgeDashboard })));
const PublicDisplayPage = lazy(() => import("./pages/PublicDisplayPage").then(m => ({ default: m.PublicDisplayPage })));
const ServerModeSelector = lazy(() => import("./components/admin/ServerModeSelector").then(m => ({ default: m.ServerModeSelector })));

type AuthScreen = 'choice' | 'admin' | 'judge' | 'server-mode';

// Loading компонент для Suspense fallback
function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500 mx-auto mb-4"></div>
        <p className="text-gray-600">Загрузка...</p>
      </div>
    </div>
  );
}

function App() {
  // КРИТИЧНО: Проверяем label окна СИНХРОННО до первого рендера
  // чтобы избежать бесконечного цикла ре-рендеров публичного табло
  const currentWindow = getCurrentWebviewWindow();
  const isPublicDisplayWindow = currentWindow.label === 'public-display';

  const [authScreen, setAuthScreen] = useState<AuthScreen>('choice');
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isAutoLoginInProgress, setIsAutoLoginInProgress] = useState(false);
  const [autoLoginRole, setAutoLoginRole] = useState<'admin' | 'judge' | null>(null);
  const { isAuthenticated, user, loginAsAdmin, loginAsAdminOffline, loginAsJudge, logout } = useAuthStore();

  console.log('[App] Window label:', currentWindow.label, 'isPublicDisplay:', isPublicDisplayWindow);

  // Автоосвобождение стола при закрытии приложения (если судья)
  useEffect(() => {
    // Не устанавливать обработчик для публичного табло
    if (isPublicDisplayWindow) return;
    if (!user || user.role !== 'referee') return;

    const currentWindow = getCurrentWebviewWindow();
    let unlistenClose: (() => void) | null = null;
    let isClosing = false;

    // Также добавляем обработчик beforeunload для гарантии
    const handleBeforeUnload = () => {
      console.log('[Window Close] beforeunload - releasing table synchronously...');
      // Синхронный вызов для немедленного освобождения
      if (user && user.table_number && user.tournament_id) {
        try {
          // Вызываем Tauri команду через invoke API
          invoke('release_table_number', {
            tournamentId: user.tournament_id,
            tableNumber: user.table_number,
          }).catch(console.error);
        } catch (error) {
          console.error('[Window Close] Error in beforeunload:', error);
        }
      }
    };

    const setupCloseHandler = async () => {
      // 1. Обработчик Tauri onCloseRequested (основной)
      unlistenClose = await currentWindow.onCloseRequested(async (event) => {
        if (isClosing) return;

        event.preventDefault();

        // Проверяем наличие несинхронизированных данных
        try {
          const unsyncedCount = await checkUnsyncedCount();

          if (unsyncedCount > 0) {
            const shouldClose = window.confirm(
              `У вас есть ${unsyncedCount} несинхронизированных записей.\n\n` +
              `Если вы закроете приложение сейчас, эти данные останутся на этом компьютере ` +
              `и НЕ будут отправлены на сервер.\n\n` +
              `Рекомендуется дождаться синхронизации или выгрузить данные вручную.\n\n` +
              `Всё равно закрыть приложение?`
            );

            if (!shouldClose) {
              console.log('[Window Close] Закрытие отменено пользователем - есть несинхронизированные данные');
              return; // НЕ закрываем окно
            }
          }
        } catch (error) {
          console.error('[Window Close] Ошибка проверки несинхронизированных данных:', error);
          // Продолжаем закрытие даже при ошибке проверки
        }

        isClosing = true;

        console.log('[Window Close] Releasing table before close...');

        // Закрываем публичное табло перед выходом
        try {
          const { closePublicDisplay } = await import('./utils/publicDisplay');
          await closePublicDisplay();
          console.log('[Window Close] Public display closed');
        } catch (error) {
          console.error('[Window Close] Error closing public display:', error);
          // Продолжаем даже если не удалось закрыть
        }

        // FIX: Используем Promise.race с timeout 2000ms вместо 100ms
        // logout() может занять до 1500ms (3 попытки × 500ms для release_table_number)
        try {
          await Promise.race([
            logout(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Logout timeout')), 2000)
            )
          ]);
          console.log('[Window Close] Table released successfully');
        } catch (error) {
          console.error('[Window Close] Error during logout:', error);
          // Продолжаем закрытие даже если logout failed
        }

        if (unlistenClose) {
          unlistenClose();
          unlistenClose = null;
        }

        // Без дополнительной задержки, т.к. logout уже отработал или превысил timeout
        // Закрываем окно
        await currentWindow.destroy();
      });

      // 2. Добавляем browser beforeunload как запасной вариант
      window.addEventListener('beforeunload', handleBeforeUnload);
    };

    setupCloseHandler();

    return () => {
      if (unlistenClose) {
        unlistenClose();
      }
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [user, logout, isPublicDisplayWindow]);

  // Инициализация завершена
  useEffect(() => {
    setIsCheckingAuth(false);
  }, []);

  // Сброс экрана авторизации при выходе
  useEffect(() => {
    if (!isAuthenticated) {
      setAuthScreen('choice');
    }
  }, [isAuthenticated]);

  // Render public display if this window is for that
  if (isPublicDisplayWindow) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<LoadingSpinner />}>
          <PublicDisplayPage />
        </Suspense>
      </ErrorBoundary>
    );
  }

  const handleSelectRole = async (role: 'admin' | 'judge') => {
    // Устанавливаем индикатор загрузки
    setIsAutoLoginInProgress(true);
    setAutoLoginRole(role);

    try {
      if (role === 'admin') {
        // Попытка автовхода для админа
        try {
          const credentials = await getSavedCredentials();

          if (credentials) {
            const [login, password, userId] = credentials;
            console.log('[Auto-login Admin] Attempting automatic login with saved credentials');

            try {
              // Сначала пробуем online вход
              await loginAsAdmin(login, password);
              console.log('[Auto-login Admin] Online success');
              return; // Успешный вход, не показываем форму
            } catch (error) {
              console.error('[Auto-login Admin] Online failed, trying offline:', error);

              // Если online не удался - используем offline вход
              try {
                loginAsAdminOffline(login, userId);
                console.log('[Auto-login Admin] Offline success');
                return; // Успешный offline вход
              } catch (offlineError) {
                console.error('[Auto-login Admin] Offline failed:', offlineError);
                // Если и offline не удался - покажем форму входа
              }
            }
          }
        } catch (error) {
          console.error('[Auto-login Admin] Error checking credentials:', error);
        }
      }

      if (role === 'judge') {
        // Попытка автовхода для судьи
        try {
          const judgeCredentials = await getSavedJudgeCredentials();

          if (judgeCredentials) {
            const [pinCode, judgeName, tableNumber] = judgeCredentials;
            console.log('[Auto-login Judge] Attempting automatic login with saved credentials');
            console.log('[Auto-login Judge] PIN:', pinCode, 'Judge:', judgeName, 'Table:', tableNumber);

            try {
              // Пытаемся войти с сохраненными данными
              await loginAsJudge(pinCode, judgeName, tableNumber);
              console.log('[Auto-login Judge] Login success');
              return; // Успешный вход, не показываем форму
            } catch (error) {
              const errorStr = String(error);
              console.error('[Auto-login Judge] Login failed:', errorStr);

              // Если стол занят - показываем форму для выбора другого стола
              if (errorStr.includes('уже занят') || errorStr.includes('already occupied')) {
                console.log('[Auto-login Judge] Table occupied, showing login form');
                // Показываем форму входа
              } else {
                // Для других ошибок тоже показываем форму
                console.log('[Auto-login Judge] Other error, showing login form');
              }
            }
          }
        } catch (error) {
          console.error('[Auto-login Judge] Error checking credentials:', error);
        }
      }

      // Показываем форму входа (либо для судьи, либо если автовход не удался)
      setAuthScreen(role);
    } finally {
      // Сбрасываем индикатор загрузки
      setIsAutoLoginInProgress(false);
      setAutoLoginRole(null);
    }
  };

  const handleOpenServerMode = () => {
    setAuthScreen('server-mode');
  };

  const handleLoginSuccess = () => {
    // Успешный вход - ничего не делаем, компонент перерисуется автоматически
  };

  const handleBack = () => {
    setAuthScreen('choice');
  };

  // Показываем загрузку пока проверяем авторизацию
  if (isCheckingAuth) {
    return <LoadingSpinner />;
  }

  // Если пользователь авторизован
  if (isAuthenticated && user) {
    // Админ панель
    if (user.role === 'organizer' || user.role === 'admin') {
      return (
        <ErrorBoundary>
          <ConnectionStatusBanner alwaysShow />
          <Suspense fallback={<LoadingSpinner />}>
            <AdminDashboard />
          </Suspense>
        </ErrorBoundary>
      );
    }

    // Судейская панель
    return (
      <ErrorBoundary>
        <ConnectionStatusBanner alwaysShow />
        <Suspense fallback={<LoadingSpinner />}>
          <JudgeDashboard />
        </Suspense>
      </ErrorBoundary>
    );
  }

  // Экраны авторизации
  return (
    <ErrorBoundary>
      {authScreen === 'choice' && (
        <LoginChoice
          onSelectRole={handleSelectRole}
          onOpenServerMode={handleOpenServerMode}
          isAutoLoginInProgress={isAutoLoginInProgress}
          autoLoginRole={autoLoginRole}
        />
      )}
      {authScreen === 'admin' && (
        <Suspense fallback={<LoadingSpinner />}>
          <AdminLogin
            onBack={handleBack}
            onSuccess={handleLoginSuccess}
          />
        </Suspense>
      )}
      {authScreen === 'judge' && (
        <Suspense fallback={<LoadingSpinner />}>
          <JudgeLogin
            onBack={handleBack}
            onSuccess={handleLoginSuccess}
          />
        </Suspense>
      )}
      {authScreen === 'server-mode' && (
        <Suspense fallback={<LoadingSpinner />}>
          <ServerModeSelector
            currentMode="online"
            onModeChange={handleBack}
            onBack={handleBack}
            isJudgeMode={true}
          />
        </Suspense>
      )}
    </ErrorBoundary>
  );
}

export default App;
