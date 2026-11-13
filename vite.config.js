import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// Where the dev server forwards API calls. Defaults to the backend on this computer.
// To use a backend on another machine, put BACKEND_URL=http://<ip>:8000 in a root .env.local
// (ignored by git), e.g. BACKEND_URL=http://10.41.30.28:8000 — never commit a personal address.
export default defineConfig(({ mode }) => {
  const backend = loadEnv(mode, process.cwd(), '').BACKEND_URL || 'http://127.0.0.1:8000'
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/liveroads-api': {
          target: 'https://liveroads.co.uk',
          changeOrigin: true,
          rewrite: path => path.replace(/^\/liveroads-api/, ''),
        },
        '/backend': {
          target: backend,
          changeOrigin: true,
          rewrite: path => path.replace(/^\/backend/, ''),
        },
        '/api': { target: backend, changeOrigin: true },
        '/health': { target: backend, changeOrigin: true },
      },
    },
  }
})
