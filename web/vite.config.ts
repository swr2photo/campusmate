import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../public'),
    emptyOutDir: false,
    assetsDir: 'hosted-assets',
    rollupOptions: {
      input: {
        admin: path.resolve(__dirname, 'admin.html'),
        reset: path.resolve(__dirname, 'reset.html'),
        'email-verified': path.resolve(__dirname, 'email-verified.html'),
        index: path.resolve(__dirname, 'index.html'),
      },
    },
  },
});
