import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

/**
 * Утилита для безопасного закрытия публичного табло зрителей
 * Используется при выходе из матча, выходе судьи и закрытии приложения
 */
export async function closePublicDisplay(): Promise<boolean> {
  try {
    console.log('[PublicDisplay Utils] Попытка закрыть публичное окно...');
    const publicWindow = await WebviewWindow.getByLabel('public-display');

    if (publicWindow) {
      await publicWindow.close();
      console.log('[PublicDisplay Utils] Публичное окно успешно закрыто');
      return true;
    } else {
      console.log('[PublicDisplay Utils] Публичное окно не найдено (уже закрыто)');
      return false;
    }
  } catch (error) {
    console.error('[PublicDisplay Utils] Ошибка при закрытии публичного окна:', error);
    return false;
  }
}
