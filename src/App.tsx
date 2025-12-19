import { useState, useEffect, lazy, Suspense } from "react";
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { LoginChoice } from "./components/auth/LoginChoice";
import { useAuthStore } from "./stores/authStore";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";

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
  const [authScreen, setAuthScreen] = useState<AuthScreen>('choice');
  const [isPublicDisplay, setIsPublicDisplay] = useState(false);
  const { isAuthenticated, user } = useAuthStore();

  // Check if this is the public display window
  useEffect(() => {
    const currentWindow = getCurrentWebviewWindow();
    if (currentWindow.label === 'public-display') {
      setIsPublicDisplay(true);
    }
  }, []);

  // Render public display if this window is for that
  if (isPublicDisplay) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<LoadingSpinner />}>
          <PublicDisplayPage />
        </Suspense>
      </ErrorBoundary>
    );
  }

  const handleSelectRole = (role: 'admin' | 'judge') => {
    setAuthScreen(role);
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

  // Если пользователь авторизован
  if (isAuthenticated && user) {
    // Админ панель
    if (user.role === 'organizer' || user.role === 'admin') {
      return (
        <ErrorBoundary>
          <Suspense fallback={<LoadingSpinner />}>
            <AdminDashboard />
          </Suspense>
        </ErrorBoundary>
      );
    }

    // Судейская панель
    return (
      <ErrorBoundary>
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
