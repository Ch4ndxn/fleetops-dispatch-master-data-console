import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(fileURLToPath(import.meta.url), '..'),
      },
    },
    // Rolldown (Vite 8) can produce TDZ errors with CJS packages that use
    // `exports = module.exports = function(){}` self-reference pattern.
    // Force pre-bundling these packages through esbuild to avoid the issue.
    optimizeDeps: {
      include: ['groq-sdk'],
    },
    build: {
      // Keep groq-sdk out of the Rolldown chunking step to prevent
      // "Cannot access before initialization" runtime errors.
      rollupOptions: {
        output: {
          manualChunks: (id: string) => {
            if (id.includes('groq-sdk')) return 'groq-vendor';
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
