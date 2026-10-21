import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'

// While you develop, this runs api/answer.ts on your laptop so the app can
// call /api/answer. When deployed on Vercel, Vercel runs that same file.
function devApi(): Plugin {
  return {
    name: 'clearly-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/answer', async (req, res) => {
        const controller = new AbortController()
        res.on('close', () => controller.abort())
        try {
          const mod = await server.ssrLoadModule('/api/answer.ts')
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const request = new Request('http://localhost/api/answer', {
            method: req.method,
            headers: { 'Content-Type': 'application/json' },
            body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
            signal: controller.signal,
          })
          const response: Response = await mod.POST(request)
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          if (response.body) {
            const reader = response.body.getReader()
            for (;;) {
              const { done, value } = await reader.read()
              if (done) break
              res.write(value)
            }
          }
          res.end()
        } catch (error) {
          if (controller.signal.aborted) return
          res.statusCode = 500
          res.end(String(error))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load GEMINI_API_KEY from .env.local so the dev API can use it
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  return {
    plugins: [react(), devApi()],
  }
})
