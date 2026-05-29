import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/claude': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/claude/, '/v1/messages'),
        headers: {
          'anthropic-version': '2023-06-01',
          'x-api-key': process.env.VITE_ANTHROPIC_API_KEY || '',
        }
      }
    }
  }
})
