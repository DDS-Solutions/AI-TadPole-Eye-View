import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { cesiumEngine } from 'vite-plugin-cesium-engine';

export default defineConfig({
  plugins: [svelte({ configFile: './svelte.config.js' }), cesiumEngine()],
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 3500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@cesium/engine') || id.includes('node_modules/cesium')) {
            return 'vendor-cesium';
          }
          if (id.includes('node_modules/svelte')) {
            return 'vendor-framework';
          }
          if (id.includes('node_modules/uplot') || id.includes('node_modules/@tanstack')) {
            return 'vendor-viz';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/ops': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/ops': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
