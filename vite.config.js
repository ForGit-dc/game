import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset paths: the build works under /game/ on GitHub Pages, on itch.io, or at a domain root
  base: './',
  server: { host: true, port: 5173 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
