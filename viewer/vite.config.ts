import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Connect, type Plugin } from 'vite'

// dev-assets/ holds the synthetic fixture and locally published captures. It is served at
// /dev-assets/ by `npm run dev` and `npm run preview` only, so it never lands in dist/.
const DEV_ASSETS = path.resolve(import.meta.dirname, 'dev-assets')
const TYPES: Record<string, string> = { '.json': 'application/json', '.txt': 'text/plain' }

function devAssets(): Plugin {
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    const url = decodeURIComponent((req.url ?? '').split('?')[0])
    if (!url.startsWith('/dev-assets/')) return next()
    const file = path.join(DEV_ASSETS, url.slice('/dev-assets/'.length))
    if (!file.startsWith(DEV_ASSETS + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404
      return res.end('not found')
    }
    res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream')
    res.setHeader('Content-Length', statSync(file).size)
    createReadStream(file).pipe(res)
  }
  return {
    name: 'dev-assets',
    configureServer: (server) => void server.middlewares.use(serve),
    configurePreviewServer: (server) => void server.middlewares.use(serve),
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), devAssets()],
})
