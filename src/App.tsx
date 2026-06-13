import { useEffect, useState } from 'react'
import { DominancePlots } from './DominancePlots'
import { loadDominanceData, type DominanceData, type LoadProgress } from './db'
import { LoadingScreen } from './LoadingScreen'

function App() {
  const [data, setData] = useState<DominanceData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<LoadProgress | null>(null)

  useEffect(() => {
    loadDominanceData(setProgress)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
  }, [])

  if (error) {
    return <p className="text-center text-gray-400">{error}</p>
  }

  if (!data) {
    return <LoadingScreen progress={progress} />
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <DominancePlots rows={data.rows} stats={data.stats} />
    </div>
  )
}

export default App
