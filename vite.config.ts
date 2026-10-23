import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'url';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        // Service worker strategies
        strategies: 'generateSW',
        workbox: {
          // Cache the app shell
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          // Allow large assets (leaflet, supabase bundles)
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          // Network-first for API calls, cache-first for assets
          runtimeCaching: [
            {
              // Supabase API — always network, fallback to cache
              urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'supabase-api',
                networkTimeoutSeconds: 10,
                expiration: { maxEntries: 50, maxAgeSeconds: 60 },
              },
            },
          ],
          // Skip waiting so new SW activates immediately
          skipWaiting: true,
          clientsClaim: true,
        },
        manifest: {
          name: 'FleetOps Dispatch Console',
          short_name: 'FleetOps',
          description: 'Field technician GPS tracker and dispatch console',
          start_url: '/#/track',
          display: 'standalone',
          background_color: '#020617',
          theme_color: '#10b981',
          orientation: 'portrait-primary',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          ],
        },
        devOptions: {
          enabled: false, // don't run SW in dev mode
        },
      }),
    ],
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
