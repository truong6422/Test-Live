import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:3000', ws: true },
      '/api': 'http://127.0.0.1:3000'
    }
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' }
});
