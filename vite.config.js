import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/liveroads-api': {
        target: 'https://liveroads.co.uk',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/liveroads-api/, ''),
      },
      '/backend': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/backend/, ''),
      },
    },
  },
})
