import { defineConfig } from 'vite';

// The game still runs unbuilt (index.html's importmap pulls three from the CDN), so
// `python3 serve.py` keeps working. Vite is for development (instant reload) and for
// the deployed build: relative base so it works under /mars-rover/, and hashed file
// names so a browser never mixes a stale module with a fresh one.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022', // top-level await in terrain.js
    chunkSizeWarningLimit: 2000,
  },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
