import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';

// React Compiler: runs as a Babel preset through @rolldown/plugin-babel (the way @vitejs/plugin-react 6 documents it).
// Components are memoised automatically; do not add useMemo/useCallback/React.memo by habit.
// The Meridian server (server/main.ts) listens on 127.0.0.1:4310. In development Vite serves the app on 5173 and
// forwards /api to it. changeOrigin stays off so the Host header matches the Origin header the server checks on writes,
// and the SSE stream (/api/events) passes through unbuffered.
export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:4310', changeOrigin: false } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  test: { maxWorkers: 4, environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
});
