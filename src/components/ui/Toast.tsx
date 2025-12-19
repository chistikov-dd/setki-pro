import { useEffect } from 'react';
import { X } from 'lucide-react';

interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
  onClose: () => void;
}

/**
 * Toast notification компонент
 * Автоматически закрывается через duration мс
 */
export function Toast({ message, type = 'info', duration = 3000, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  // Цвета по типу
  const bgColors = {
    success: 'bg-green-600',
    error: 'bg-red-600',
    info: 'bg-blue-600',
    warning: 'bg-yellow-600',
  };

  return (
    <div
      className={`${bgColors[type]} text-white px-6 py-4 rounded-lg shadow-lg
        flex items-center justify-between gap-4 min-w-[320px] max-w-md
        animate-slide-in`}
    >
      <span className="text-base font-medium">{message}</span>
      <button
        onClick={onClose}
        className="hover:bg-white/20 rounded p-1 transition-colors"
        aria-label="Закрыть"
      >
        <X size={20} />
      </button>
    </div>
  );
}

/**
 * ToastContainer - контейнер для toast уведомлений
 * Размещается в правом верхнем углу
 */
interface ToastContainerProps {
  children: React.ReactNode;
}

export function ToastContainer({ children }: ToastContainerProps) {
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2">
      {children}
    </div>
  );
}
