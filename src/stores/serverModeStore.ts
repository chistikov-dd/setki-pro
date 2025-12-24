import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ServerMode = 'online' | 'local-server' | 'local-client';

interface ServerModeState {
  mode: ServerMode;
  serverUrl: string | null;

  setMode: (mode: ServerMode) => void;
  setServerUrl: (url: string | null) => void;
  reset: () => void;
}

/**
 * Нормализует server URL:
 * - Убирает trailing /api/v1 или /api/v1/ чтобы избежать дублирования в WebSocket URL
 * - Убирает trailing slash
 *
 * Примеры:
 * - "http://192.168.1.100:8081/api/v1" → "http://192.168.1.100:8081"
 * - "http://192.168.1.100:8081/api/v1/" → "http://192.168.1.100:8081"
 * - "http://192.168.1.100:8081" → "http://192.168.1.100:8081"
 */
function normalizeServerUrl(url: string | null): string | null {
  if (!url) return null;

  // Убираем trailing /api/v1 или /api/v1/
  let normalized = url.replace(/\/api\/v1\/?$/, '');

  // Убираем trailing slash если остался
  normalized = normalized.replace(/\/$/, '');

  return normalized;
}

export const useServerModeStore = create<ServerModeState>()(
  persist(
    (set) => ({
      mode: 'online',
      serverUrl: null,

      setMode: (mode) => set({ mode }),

      setServerUrl: (url) => set({ serverUrl: normalizeServerUrl(url) }),

      reset: () => set({ mode: 'online', serverUrl: null }),
    }),
    {
      name: 'server-mode-storage',
    }
  )
);
