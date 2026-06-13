import { useEffect, useState } from 'react'
import { ArenaMap } from './ArenaMap'
import { loadTrajectory, type TrajectoryData } from './db'

const FRAME_MS = 50

export function TrajectoryPlayback({
  simIndex,
  highlightedSlots,
}: {
  simIndex: number
  highlightedSlots: number[]
}) {
  const [trajectory, setTrajectory] = useState<TrajectoryData | null>(null)
  const [playing, setPlaying] = useState(false)
  const [frame, setFrame] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPlaying(false)
    setFrame(1)
    setTrajectory(null)
    setError(null)
  }, [simIndex])

  useEffect(() => {
    if (!playing || !trajectory) return
    const id = window.setInterval(() => {
      setFrame((current) => {
        if (current >= trajectory.maxFrame) {
          setPlaying(false)
          return trajectory.maxFrame
        }
        return current + 1
      })
    }, FRAME_MS)
    return () => clearInterval(id)
  }, [playing, trajectory])

  const startPlayback = async () => {
    if (playing) {
      setPlaying(false)
      return
    }

    setError(null)
    if (!trajectory) {
      setLoading(true)
      try {
        const data = await loadTrajectory(simIndex)
        setTrajectory(data)
        setFrame(1)
        setPlaying(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load trajectory')
      } finally {
        setLoading(false)
      }
      return
    }

    if (frame >= trajectory.maxFrame) setFrame(1)
    setPlaying(true)
  }

  const birds = trajectory?.frames.get(frame) ?? []

  return (
    <div className="flex flex-col items-center gap-1">
      <ArenaMap highlightedSlots={highlightedSlots} birds={birds} />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={startPlayback}
          disabled={loading}
          className="rounded border border-gray-600 bg-gray-800 px-2.5 py-0.5 text-[10px] text-gray-200 hover:bg-gray-700 disabled:opacity-50"
        >
          {loading ? 'Loading…' : playing ? 'Pause' : 'Play'}
        </button>
        {trajectory && (
          <span className="text-[10px] text-gray-400">
            Frame {frame}/{trajectory.maxFrame}
          </span>
        )}
      </div>
      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  )
}
