import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// @ts-expect-error process is a nodejs global
const port = process.env.VITE_PORT ? parseInt(process.env.VITE_PORT, 10) : 1420;

// @ts-expect-error process is a nodejs global
const hmrPort = process.env.VITE_HMR_PORT ? parseInt(process.env.VITE_HMR_PORT, 10) : port + 1;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Use relative paths for Tauri (tauri://localhost protocol)
  base: './',

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: hmrPort,
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
  // Build configuration for Tauri
  build: {
    // Tauri expects a fixed target for production builds
    target: ['es2021', 'chrome100', 'safari13'],
    // Don't minify for better debugging
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    // Produce sourcemaps for production debugging
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      output: {
        // CRITICAL FIX: Inline all dynamic imports to avoid import.meta.url issues in Tauri
        // Tauri's tauri://localhost protocol doesn't work well with Vite's preload helper
        inlineDynamicImports: true,
      },
    },
  },
}));
