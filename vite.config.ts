import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
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

function loadAssetSizes(): Plugin {
  const virtualId = 'virtual:load-sizes'
  const resolvedId = '\0' + virtualId

  return {
    name: 'load-asset-sizes',
    resolveId(id) {
      if (id === virtualId) return resolvedId
    },
    load(id) {
      if (id !== resolvedId) return

      const sizes = {
        duckdb: fs.statSync(
          path.join(
            root,
            'node_modules/@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm',
          ),
        ).size,
        sweep: fs.statSync(path.join(root, 'public/gulp_sweep.csv')).size,
        trajectories: fs.statSync(
          path.join(root, 'public/gulp_trajectories.parquet'),
        ).size,
      }
      const total = sizes.duckdb + sizes.sweep + sizes.trajectories

      return `export const loadAssetBytes = ${JSON.stringify(sizes)}; export const loadTotalBytes = ${total};`
    },
  }
}

export default defineConfig({
  plugins: [loadAssetSizes(), stripDuckdbWorkerSourceMap(), react(), tailwindcss()],
  assetsInclude: ['**/*.wasm'],
  worker: { format: 'es' },
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
  },
})
