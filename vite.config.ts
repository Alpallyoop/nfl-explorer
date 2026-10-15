import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// Same allow-listed client the Electron main process uses (electron/nflClient.cjs).
const client = require('./electron/nflClient.cjs') as {
  call: (base: string, op: string, params: unknown) => Promise<unknown>
  normalizeBase: (b: string) => string
  DEFAULT_BASE: string
}

// Browser development mode (npm run dev): the page posts {op, params} to /__nfl/request and this dev-server
// middleware forwards it with the main-process client, so both modes share one code path to NFL.
function nflDevBridge(): Plugin {
  const apiBase = client.normalizeBase(process.env.NFL_API_BASE || client.DEFAULT_BASE)
  return {
    name: 'nfl-dev-bridge',
    configureServer(server) {
      server.middlewares.use('/__nfl/config', (_req, res) => {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ apiBase, desktop: false }))
      })
      server.middlewares.use('/__nfl/request', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        let body = ''
        req.on('data', (c) => { body += c; if (body.length > 2_000_000) req.destroy() })
        req.on('end', async () => {
          let out: unknown
          try {
            const { op, params } = JSON.parse(body || '{}')
            out = await client.call(apiBase, String(op), params || {})
          } catch {
            out = { ok: false, status: 'REFUSED', error: 'BAD_REQUEST' }
          }
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(out))
        })
      })
    },
  }
}

// Production build (loaded by Electron from dist/): strict Content-Security-Policy. Not applied to the dev
// server, whose React refresh preamble is an inline script.
function buildCsp(): Plugin {
  const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"
  return {
    name: 'nfl-build-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`),
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), nflDevBridge(), buildCsp()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
})
