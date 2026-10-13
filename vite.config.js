import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5177,
    proxy: {
      '/api': 'http://localhost:8787',
      '/v1': 'http://localhost:8787',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // React dipisah; Firebase dibiarkan dipecah otomatis oleh Vite
        // (auth di chunk utama, firestore di chunk lazy karena dynamic import)
        manualChunks(id) {
          if (id.includes('node_modules/react')) return 'react';
        },
      },
    },
  },
});
