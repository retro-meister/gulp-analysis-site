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
    <div className="flex min-h-svh flex-col items-center justify-center px-4 min-[1920px]:px-8">
      <div className="w-full max-w-lg rounded-xl border border-gray-800 bg-[#1c1d24] px-8 py-10 shadow-lg min-[1920px]:max-w-3xl min-[1920px]:px-12 min-[1920px]:py-14">
        <div className="text-center">
          <h1 className="text-ui-2xl font-medium tracking-tight text-gray-100">
            Gulp drop analysis
          </h1>
          <p className="mt-3 text-ui-lg text-gray-400 min-[1920px]:mt-4 min-[1920px]:text-ui-xl">
            {progress?.label ?? 'Starting up…'}
          </p>
        </div>

        <div className="mt-10 space-y-3 min-[1920px]:mt-12 min-[1920px]:space-y-4">
          <div className="h-loading-bar overflow-hidden rounded-full bg-gray-800">
            <div
              className={`h-full rounded-full bg-[#27ae60] ${
                indeterminate ? 'animate-pulse' : 'transition-[width] duration-150'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-ui-base text-gray-500 min-[1920px]:text-ui-lg">
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
