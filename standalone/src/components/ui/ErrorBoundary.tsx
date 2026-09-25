import React, { Component, ReactNode } from 'react';
import { Button } from './Button';
import { Card, CardContent, CardHeader, CardTitle } from './Card';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

/**
 * ErrorBoundary - компонент для перехвата ошибок рендеринга в React
 *
 * Использование:
 * <ErrorBoundary>
 *   <YourComponent />
 * </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Логирование в консоль
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);

    // Обновить state
    this.setState({
      error,
      errorInfo,
    });

    // Вызвать callback если передан
    this.props.onError?.(error, errorInfo);

    // TODO: Отправить на сервер для мониторинга (Sentry, etc.)
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // Fallback UI если передан
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Дефолтный UI
      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-red-50 to-gray-100 p-6">
          <div className="w-full max-w-2xl">
            <Card variant="elevated">
              <CardHeader>
                <div className="flex items-center gap-4 mb-4">
                  <div className="p-4 rounded-xl bg-red-500/10 border-2 border-red-500/30">
                    <svg
                      className="w-10 h-10 text-red-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                  </div>
                  <div>
                    <CardTitle className="text-3xl text-red-600">
                      Произошла ошибка
                    </CardTitle>
                    <p className="text-gray-600 text-sm mt-2">
                      Что-то пошло не так при отображении этого компонента
                    </p>
                  </div>
                </div>
              </CardHeader>

              <CardContent>
                {/* Сообщение об ошибке */}
                <div className="mb-6 p-4 rounded-lg bg-red-500/5 border border-red-500/20">
                  <p className="text-sm text-gray-700 font-medium mb-2">
                    Сообщение об ошибке:
                  </p>
                  <p className="text-sm text-gray-600 font-mono">
                    {this.state.error?.message || 'Неизвестная ошибка'}
                  </p>
                </div>

                {/* Техническая информация (в development режиме) */}
                {import.meta.env.DEV && this.state.errorInfo && (
                  <details className="mb-6 p-4 rounded-lg bg-gray-100 border border-gray-300">
                    <summary className="cursor-pointer text-sm font-medium text-gray-700 mb-2">
                      Техническая информация (для разработчиков)
                    </summary>
                    <pre className="text-xs text-gray-600 overflow-auto max-h-64 mt-2">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </details>
                )}

                {/* Действия */}
                <div className="flex gap-4">
                  <Button
                    variant="primary"
                    onClick={this.handleReset}
                    className="flex-1"
                  >
                    Попробовать снова
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={this.handleReload}
                    className="flex-1"
                  >
                    Перезагрузить приложение
                  </Button>
                </div>

                {/* Инструкции */}
                <div className="mt-6 p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
                  <p className="text-sm text-gray-700 leading-relaxed">
                    Если проблема повторяется:
                  </p>
                  <ul className="list-disc list-inside text-sm text-gray-600 mt-2 space-y-1">
                    <li>Попробуйте перезагрузить приложение</li>
                    <li>Проверьте подключение к интернету</li>
                    <li>
                      Сообщите об ошибке администратору с описанием действий, которые к ней привели
                    </li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Компактный ErrorBoundary для вложенных компонентов
 */
export class CompactErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[CompactErrorBoundary] Caught error:', error, errorInfo);
    this.setState({ error, errorInfo });
    this.props.onError?.(error, errorInfo);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
          <div className="flex items-center gap-3 mb-3">
            <svg
              className="w-5 h-5 text-red-500 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-700">
                Ошибка отображения компонента
              </p>
              <p className="text-xs text-gray-600 mt-1">
                {this.state.error?.message || 'Неизвестная ошибка'}
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={this.handleReset}
            className="w-full"
          >
            Попробовать снова
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
