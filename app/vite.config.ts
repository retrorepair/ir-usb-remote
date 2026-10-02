import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths: the packaged app loads index.html over file://.
  base: './',
  // The generated remote database is copied verbatim into the bundle, so the
  // renderer can fetch ./db/index.json both in dev and when packaged.
  publicDir: 'resources',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120',
    // 3 MB of database shards would otherwise produce a wall of warnings.
    chunkSizeWarningLimit: 4096,
  },
  server: { port: 5173, strictPort: true },
});
