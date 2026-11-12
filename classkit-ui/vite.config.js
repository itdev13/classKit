import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Split deploy (like HelmDesk): UI on Vercel, API at VITE_API_URL. Locally, proxy to the API on :3030.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: { '/api': 'http://localhost:3030', '/oauth': 'http://localhost:3030' }
  }
});
