import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      // Two independent entries: the shop (/) and the public company
      // structure (/company/), which has no phone gate.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        company: fileURLToPath(new URL('./company/index.html', import.meta.url)),
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    fs: {
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/замовлення/**', '**/supabase/.env*'],
    },
  },
});
