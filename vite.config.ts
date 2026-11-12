import fs from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

function geojsonPlugin(): Plugin {
  return {
    name: 'vite-plugin-geojson',
    transform(_code, id) {
      const cleanId = id.split('?')[0];
      if (cleanId.endsWith('.geojson')) {
        const raw = fs.readFileSync(cleanId, 'utf-8');
        return {
          code: `export default ${raw};`,
          map: null,
        };
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [geojsonPlugin(), react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          leaflet: ['leaflet'],
          turf: ['@turf/turf'],
          firebase: ['firebase/app', 'firebase/auth', 'firebase/database'],
          qr: ['html5-qrcode', 'qrcode.react'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
