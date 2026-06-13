/// <reference types="vite/client" />

declare module 'virtual:load-sizes' {
  export const loadAssetBytes: {
    duckdb: number
    sweep: number
    trajectories: number
  }
  export const loadTotalBytes: number
}
