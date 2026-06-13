import { useEffect, useRef, useState } from 'react'
import { ArenaMap } from './ArenaMap'
import { CYCLE_FRAME_OFFSET, toDisplayFrame } from './cycleFrames'
import { loadTrajectory, rowBirdAssignments, type DominanceRow, type TrajectoryData } from './db'
import { ARENA_SIZE } from './arenaProjection'

const FRAME_MS = 1000 / 30

function playbackStartFrame(maxFrame: number) {
  return Math.min(CYCLE_FRAME_OFFSET + 1, maxFrame)
}

function displayMaxFrame(maxFrame: number) {
  return toDisplayFrame(maxFrame)
}

export function TrajectoryPlayback({
  simIndex,
  selected,
  keyboardActive = false,
  onActivate,
}: {
  simIndex: number
  selected: DominanceRow
  keyboardActive?: boolean
  onActivate?: () => void
}) {
  const [trajectory, setTrajectory] = useState<TrajectoryData | null>(null)
  const [playing, setPlaying] = useState(false)
  const [frame, setFrame] = useState(CYCLE_FRAME_OFFSET + 1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const birdAssignments = rowBirdAssignments(selected)

  useEffect(() => {
    setPlaying(false)
    setFrame(CYCLE_FRAME_OFFSET + 1)
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

  const ensureTrajectory = async () => {
    if (trajectory) return trajectory
    setLoading(true)
    setError(null)
    try {
      const data = await loadTrajectory(simIndex)
      setTrajectory(data)
      setFrame(playbackStartFrame(data.maxFrame))
      return data
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load trajectory')
      return null
    } finally {
      setLoading(false)
    }
  }

  const togglePlayback = async () => {
    if (playing) {
      setPlaying(false)
      return
    }

    const data = trajectory ?? (await ensureTrajectory())
    if (!data) return

    if (frame >= data.maxFrame) setFrame(playbackStartFrame(data.maxFrame))
    setPlaying(true)
  }

  const toggleRef = useRef(togglePlayback)
  toggleRef.current = togglePlayback

  useEffect(() => {
    if (!keyboardActive) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return
      const target = e.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return
      }
      e.preventDefault()
      void toggleRef.current()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [keyboardActive])

  const scrubTo = (nextFrame: number) => {
    setPlaying(false)
    setFrame(nextFrame)
  }

  const handleScrub = async (value: number) => {
    if (!trajectory) {
      const data = await ensureTrajectory()
      if (!data) return
      const min = playbackStartFrame(data.maxFrame)
      scrubTo(Math.max(min, Math.min(value, data.maxFrame)))
      return
    }
    scrubTo(value)
  }

  const birds = trajectory?.frames.get(frame) ?? []
  const playbackFrame = trajectory ? frame : undefined
  const minFrame = trajectory ? playbackStartFrame(trajectory.maxFrame) : CYCLE_FRAME_OFFSET + 1
  const maxFrame = trajectory?.maxFrame ?? CYCLE_FRAME_OFFSET + 1

  return (
    <div
      className="flex flex-col items-center gap-1.5"
      style={{ width: ARENA_SIZE }}
      onPointerDown={onActivate}
    >
      <ArenaMap
        birdAssignments={birdAssignments}
        playbackFrame={playbackFrame}
        birds={birds}
      />
      <div className="flex w-full items-center gap-2">
        <button
          type="button"
          onClick={togglePlayback}
          disabled={loading}
          className="shrink-0 rounded border border-gray-600 bg-gray-800 px-2.5 py-0.5 text-[10px] text-gray-200 hover:bg-gray-700 disabled:opacity-50"
        >
          {loading ? 'Loading…' : playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          min={minFrame}
          max={maxFrame}
          value={frame}
          disabled={loading}
          onPointerDown={() => {
            if (!trajectory && !loading) void ensureTrajectory()
          }}
          onChange={(e) => void handleScrub(Number(e.target.value))}
          className="h-1 min-w-0 flex-1 cursor-pointer accent-sky-400 disabled:opacity-40"
        />
        <span className="w-14 shrink-0 text-right font-mono text-[10px] tabular-nums text-gray-400">
          {trajectory
            ? `${toDisplayFrame(frame)}/${displayMaxFrame(trajectory.maxFrame)}`
            : '—/—'}
        </span>
      </div>
      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  )
}
