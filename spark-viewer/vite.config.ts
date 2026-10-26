import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// VITE_BASE is set by the Pages workflow (e.g. /NAMMA-SPACE/); locally the app is served from "/".
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
})
