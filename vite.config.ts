import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base 为相对路径，部署到 GitHub Pages 的任意仓库子路径都能正常加载
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
  },
} as never);
