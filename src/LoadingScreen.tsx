export function LoadingScreen({ status }: { status: string | null }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-4 min-[1920px]:px-8">
      <div className="w-full max-w-lg rounded-xl border border-gray-800 bg-[#1c1d24] px-8 py-10 shadow-lg min-[1920px]:max-w-3xl min-[1920px]:px-12 min-[1920px]:py-14">
        <div className="text-center">
          <h1 className="text-ui-2xl font-medium tracking-tight text-gray-100">
            Gulp drop analysis
          </h1>
          <p className="mt-3 text-ui-lg text-gray-400 min-[1920px]:mt-4 min-[1920px]:text-ui-xl">
            {status ?? 'Starting up…'}
          </p>
        </div>

        <div className="mt-10 min-[1920px]:mt-12">
          <div className="h-loading-bar overflow-hidden rounded-full bg-gray-800">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-[#27ae60]" />
          </div>
        </div>
      </div>
    </div>
  )
}
