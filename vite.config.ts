import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

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
