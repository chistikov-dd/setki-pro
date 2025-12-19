import { useState, useEffect } from 'react';

/**
 * Hook для отслеживания видимости страницы/вкладки
 * Останавливает автообновление когда пользователь переключился на другую вкладку
 *
 * @returns boolean - true если страница видима, false если скрыта
 */
export function usePageVisibility(): boolean {
  const [isVisible, setIsVisible] = useState(!document.hidden);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return isVisible;
}
