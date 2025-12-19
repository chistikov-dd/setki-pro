import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  // Force CSS reload for Tailwind v4
  css: {
    devSourcemap: true,
  },
  optimizeDeps: {
    exclude: ['@tailwindcss/postcss'],
  },
  // Code splitting для оптимизации bundle size
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Vendor chunks - основные библиотеки
          if (id.includes('node_modules')) {
            // React и связанные библиотеки
            if (id.includes('react') || id.includes('react-dom') || id.includes('scheduler')) {
              return 'vendor-react';
            }
            // State management
            if (id.includes('zustand')) {
              return 'vendor-state';
            }
            // Tauri и WebSocket
            if (id.includes('@tauri-apps')) {
              return 'vendor-tauri';
            }
            // UI библиотеки (radix, clsx, tailwind-merge и т.д.)
            if (id.includes('@radix-ui') || id.includes('clsx') || id.includes('tailwind-merge')) {
              return 'vendor-ui';
            }
            // Остальные vendor библиотеки
            return 'vendor-other';
          }

          // Application chunks - логические группы по функционалу
          // Match Screen и связанные компоненты
          if (id.includes('/components/match/') || id.includes('/pages/PublicDisplayPage')) {
            return 'app-match';
          }
          // Bracket visualization компоненты
          if (id.includes('/components/brackets/')) {
            return 'app-brackets';
          }
          // Admin компоненты
          if (id.includes('/components/admin/')) {
            return 'app-admin';
          }
          // Judge компоненты
          if (id.includes('/components/judge/')) {
            return 'app-judge';
          }
          // Auth компоненты
          if (id.includes('/components/auth/')) {
            return 'app-auth';
          }
        },
      },
    },
  },
}));
