import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:3000', ws: true },
      '/api': 'http://127.0.0.1:3000',
      // Ảnh cá (sprite) + khung xem trước overlay. Mặc định trỏ vào Vite dev của overlay (cổng 5173);
      // chỉ chạy server (đã build overlay) thì đặt OVERLAY_DEV_URL=http://127.0.0.1:3000.
      '/overlay': { target: process.env.OVERLAY_DEV_URL ?? 'http://127.0.0.1:5173', ws: true }
    }
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' }
});
