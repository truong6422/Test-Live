import { defineConfig } from 'vite';

export default defineConfig({
  base: '/overlay/',
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:3000', ws: true },
      '/api': 'http://127.0.0.1:3000'
    }
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 1500 }
});
