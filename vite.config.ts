import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function stripDuckdbWorkerSourceMap(): Plugin {
  return {
    name: 'strip-duckdb-worker-sourcemap',
    transform(code, id) {
      if (!id.includes('duckdb-browser-mvp.worker')) return
      return code.replace(/\/\/# sourceMappingURL=.*$/m, '')
    },
  }
}

export default defineConfig({
  plugins: [stripDuckdbWorkerSourceMap(), react(), tailwindcss()],
  assetsInclude: ['**/*.wasm'],
  worker: { format: 'es' },
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
  },
})
