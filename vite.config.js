import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/liveroads-api': {
        target: 'https://liveroads.co.uk',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/liveroads-api/, ''),
      },
    },
  },
})