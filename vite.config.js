import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        agent: fileURLToPath(new URL('./agent.html', import.meta.url)),
      },
    },
  },
  server: {
    proxy: {
      '/liveroads-api': {
        target: 'https://liveroads.co.uk',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/liveroads-api/, ''),
      },
      '/backend': {
        target: 'http://10.41.30.28:8000',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/backend/, ''),
      },
      '/api': {
        target: 'http://10.41.30.28:8000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://10.41.30.28:8000',
        changeOrigin: true,
      },
    },
  },
})