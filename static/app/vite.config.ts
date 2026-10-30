import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  // Forge serves Custom UI assets from a nested path, so asset URLs must be relative.
  base: './',
  plugins: [react()],
  server: { port: 3000, fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 800 },
});
