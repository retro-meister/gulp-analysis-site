/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_R2_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module 'virtual:load-sizes' {
  export const loadAssetBytes: {
    duckdb: number
    sweep: number
    trajectories: number
  }
  export const loadTotalBytes: number
}
