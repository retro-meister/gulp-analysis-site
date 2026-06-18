import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const root = path.dirname(fileURLToPath(import.meta.url))

function stripDuckdbWorkerSourceMap(): Plugin {
  return {
    name: 'strip-duckdb-worker-sourcemap',
    transform(code, id) {
      if (!id.includes('duckdb-browser-mvp.worker')) return
      return code.replace(/\/\/# sourceMappingURL=.*$/m, '')
    },
  }
}

function remoteDuckdbWasm(r2BaseUrl?: string): Plugin {
  const virtualId = '\0virtual:duckdb-mvp.wasm'

  return {
    name: 'remote-duckdb-wasm',
    enforce: 'pre',
    resolveId(source) {
      if (!r2BaseUrl) return
      if (source.endsWith('duckdb-mvp.wasm?url')) return virtualId
    },
    load(id) {
      if (id !== virtualId || !r2BaseUrl) return
      const url = `${r2BaseUrl.replace(/\/$/, '')}/duckdb-mvp.wasm`
      return `export default ${JSON.stringify(url)}`
    },
  }
}

function stripRemoteDataAssets(r2BaseUrl?: string): Plugin {
  return {
    name: 'strip-remote-data-assets',
    closeBundle() {
      if (!r2BaseUrl) return
      const dist = path.join(root, 'dist')
      for (const file of ['gulp_sweep.csv', 'gulp_trajectories.parquet']) {
        const target = path.join(dist, file)
        if (fs.existsSync(target)) fs.unlinkSync(target)
      }
      const assetsDir = path.join(dist, 'assets')
      if (fs.existsSync(assetsDir)) {
        for (const entry of fs.readdirSync(assetsDir)) {
          if (entry.endsWith('.wasm')) {
            fs.unlinkSync(path.join(assetsDir, entry))
          }
        }
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, '')
  return {
    plugins: [
      remoteDuckdbWasm(env.VITE_R2_BASE_URL),
      stripDuckdbWorkerSourceMap(),
      stripRemoteDataAssets(env.VITE_R2_BASE_URL),
      react(),
      tailwindcss(),
    ],
    assetsInclude: ['**/*.wasm'],
    worker: { format: 'es' },
    optimizeDeps: {
      exclude: ['@duckdb/duckdb-wasm'],
    },
  }
})
