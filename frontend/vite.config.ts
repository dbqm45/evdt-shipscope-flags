import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // during development, forward /api/* to the NestJS backend (npm run start:dev in the repo root)
    proxy: { '/api': 'http://localhost:3000' },
  },
})
