import type { LoadProgress } from './db'
import { loadTotalBytes } from 'virtual:load-sizes'

function formatMb(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function LoadingScreen({ progress }: { progress: LoadProgress | null }) {
  const overallTotal = progress?.overallTotal ?? loadTotalBytes
  const overallLoaded = progress?.overallLoaded ?? 0
  const pct =
    overallTotal > 0
      ? Math.min(100, Math.round((100 * overallLoaded) / overallTotal))
      : 0
  const indeterminate = progress?.phase === 'queries'

  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-gray-800 bg-[#1c1d24] px-6 py-8 shadow-lg">
        <div className="text-center">
          <h1 className="text-lg font-medium tracking-tight text-gray-100">
            Gulp drop analysis
          </h1>
          <p className="mt-2 text-sm text-gray-400">
            {progress?.label ?? 'Starting up…'}
          </p>
        </div>

        <div className="mt-8 space-y-2">
          <div className="h-2.5 overflow-hidden rounded-full bg-gray-800">
            <div
              className={`h-full rounded-full bg-[#27ae60] ${
                indeterminate ? 'animate-pulse' : 'transition-[width] duration-150'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-500">
            <span>
              {formatMb(overallLoaded)} / {formatMb(overallTotal)}
            </span>
            {progress?.phase === 'queries' ? (
              <span>Almost ready</span>
            ) : (
              <span>{pct}%</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
