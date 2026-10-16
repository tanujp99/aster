import { defineConfig } from 'vite';

export default defineConfig({
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 12000 },
  optimizeDeps: { exclude: ['@techstark/opencv-js'] },
});
