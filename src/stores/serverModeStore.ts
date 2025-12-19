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

export const useServerModeStore = create<ServerModeState>()(
  persist(
    (set) => ({
      mode: 'online',
      serverUrl: null,

      setMode: (mode) => set({ mode }),

      setServerUrl: (url) => set({ serverUrl: url }),

      reset: () => set({ mode: 'online', serverUrl: null }),
    }),
    {
      name: 'server-mode-storage',
    }
  )
);
