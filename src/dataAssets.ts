const r2Base = import.meta.env.VITE_R2_BASE_URL?.replace(/\/$/, '')

export function dataAssetUrl(filename: string): string {
  const path = filename.replace(/^\//, '')
  if (r2Base) return `${r2Base}/${path}`
  return `/${path}`
}

export function usesRemoteDataAssets(): boolean {
  return Boolean(r2Base)
}
