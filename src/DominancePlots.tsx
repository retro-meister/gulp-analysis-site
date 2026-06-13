import { memo, useCallback, useMemo, useRef, useState, useEffect } from 'react'
import type { DominanceRow, DominanceStats, ReferencePoint, Zone } from './db'
import {
  classifyZone,
  findRowByDrops,
  rowDropSlots,
  statsForReference,
} from './db'
import { TrajectoryPlayback } from './TrajectoryPlayback'

const PAD = { top: 24, right: 16, bottom: 48, left: 58 }
const W = 400
const H = 400

type PlotPoint = {
  sim_index: number
  cx: number
  cy: number
  zone: Zone
}

type Viewport = {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

function boundsFromRows(rows: DominanceRow[]): Viewport {
  const spreads = rows.map((r) => r.spread)
  const frames = rows.map((r) => r.frame)
  const xMin = Math.min(...spreads)
  const xMax = Math.max(...spreads)
  const yMin = Math.min(...frames)
  const yMax = Math.max(...frames)
  const xPad = (xMax - xMin || 1) * 0.05
  const yPad = (yMax - yMin || 1) * 0.05
  return {
    xMin: xMin - xPad,
    xMax: xMax + xPad,
    yMin: yMin - yPad,
    yMax: yMax + yPad,
  }
}

function spansEqual(a: number, b: number) {
  const denom = Math.max(Math.abs(a), Math.abs(b), 1)
  return Math.abs(a - b) / denom < 0.005
}

function clampViewport(next: Viewport, full: Viewport): Viewport {
  const fullXSpan = full.xMax - full.xMin || 1
  const fullYSpan = full.yMax - full.yMin || 1
  const minXSpan = fullXSpan * 0.03
  const minYSpan = fullYSpan * 0.03

  const clampAxis = (
    min: number,
    max: number,
    fullMin: number,
    fullMax: number,
    minSpan: number,
  ): [number, number] => {
    let span = max - min
    const fullSpan = fullMax - fullMin || 1

    if (span < minSpan) {
      const center = (min + max) / 2
      min = center - minSpan / 2
      max = center + minSpan / 2
      span = minSpan
    }

    if (span >= fullSpan || spansEqual(span, fullSpan)) {
      return [fullMin, fullMax]
    }

    if (min < fullMin) {
      max += fullMin - min
      min = fullMin
    }
    if (max > fullMax) {
      min -= max - fullMax
      max = fullMax
    }

    if (max - min >= fullSpan || spansEqual(max - min, fullSpan)) {
      return [fullMin, fullMax]
    }

    return [min, max]
  }

  const [xMin, xMax] = clampAxis(
    next.xMin,
    next.xMax,
    full.xMin,
    full.xMax,
    minXSpan,
  )
  const [yMin, yMax] = clampAxis(
    next.yMin,
    next.yMax,
    full.yMin,
    full.yMax,
    minYSpan,
  )

  return { xMin, xMax, yMin, yMax }
}

function zoomViewport(
  viewport: Viewport,
  full: Viewport,
  anchorX: number,
  anchorY: number,
  scale: number,
): Viewport {
  const fullXSpan = full.xMax - full.xMin || 1
  const fullYSpan = full.yMax - full.yMin || 1
  const xSpan = viewport.xMax - viewport.xMin
  const ySpan = viewport.yMax - viewport.yMin
  const newXSpan = xSpan * scale
  const newYSpan = ySpan * scale
  const xRatio = (anchorX - viewport.xMin) / (xSpan || 1)
  const yRatio = (anchorY - viewport.yMin) / (ySpan || 1)

  const next = {
    xMin: anchorX - newXSpan * xRatio,
    xMax: anchorX + newXSpan * (1 - xRatio),
    yMin: anchorY - newYSpan * yRatio,
    yMax: anchorY + newYSpan * (1 - yRatio),
  }

  if (scale > 1) {
    if (newXSpan >= fullXSpan * 0.97) {
      next.xMin = full.xMin
      next.xMax = full.xMax
    }
    if (newYSpan >= fullYSpan * 0.97) {
      next.yMin = full.yMin
      next.yMax = full.yMax
    }
  }

  return clampViewport(next, full)
}

function pixelToData(
  px: number,
  py: number,
  viewport: Viewport,
  plotW: number,
  plotH: number,
) {
  const xRatio = (px - PAD.left) / plotW
  const yRatio = (py - PAD.top) / plotH
  return {
    spread: viewport.xMin + xRatio * (viewport.xMax - viewport.xMin),
    frame: viewport.yMax - yRatio * (viewport.yMax - viewport.yMin),
  }
}

function scaleLinear(
  domain: [number, number],
  range: [number, number],
): (v: number) => number {
  const [d0, d1] = domain
  const [r0, r1] = range
  const span = d1 - d0 || 1
  return (v) => r0 + ((v - d0) / span) * (r1 - r0)
}

function axisTicks(min: number, max: number, count = 5): number[] {
  if (min === max) return [min]
  return Array.from({ length: count }, (_, i) => min + (i / (count - 1)) * (max - min))
}

function formatTick(v: number): string {
  return Math.round(v).toLocaleString()
}

function parseDropSlot(value: string): number | null {
  const n = Number.parseInt(value.trim(), 10)
  if (!Number.isInteger(n) || n < 1 || n > 25) return null
  return n
}

function DropLookup({
  cycle,
  rows,
  selected,
  onSelect,
  onSetReference,
  onResetReference,
  referenceIsWr,
}: {
  cycle: number
  rows: DominanceRow[]
  selected: DominanceRow
  onSelect: (simIndex: number) => void
  onSetReference: () => void
  onResetReference: () => void
  referenceIsWr: boolean
}) {
  const threeBird = cycle >= 3
  const [bird0, setBird0] = useState(String(selected.bird0_drop))
  const [bird1, setBird1] = useState(String(selected.bird1_drop))
  const [bird2, setBird2] = useState(
    selected.bird2_drop != null ? String(selected.bird2_drop) : '',
  )
  const [error, setError] = useState<string | null>(null)

  const tryLookup = (nextBird0: string, nextBird1: string, nextBird2: string) => {
    const b0 = parseDropSlot(nextBird0)
    const b1 = parseDropSlot(nextBird1)
    const b2 = threeBird ? parseDropSlot(nextBird2) : null

    if (b0 == null || b1 == null || (threeBird && b2 == null)) {
      setError(null)
      return
    }

    const row = findRowByDrops(rows, b0, b1, b2)
    if (!row) {
      setError('invalid')
      return
    }

    setError(null)
    onSelect(row.sim_index)
  }

  const inputClass =
    'w-11 rounded border border-gray-600 bg-gray-900 px-1.5 py-0.5 text-center text-xs text-gray-100'

  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <div className="flex flex-col items-center gap-1.5">
        <label className="flex flex-col items-center gap-1 text-[10px] text-gray-400">
          Bird 0
          <input
            type="number"
            min={1}
            max={25}
            value={bird0}
            onChange={(e) => {
              const next = e.target.value
              setBird0(next)
              tryLookup(next, bird1, bird2)
            }}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col items-center gap-1 text-[10px] text-gray-400">
          Bird 1
          <input
            type="number"
            min={1}
            max={25}
            value={bird1}
            onChange={(e) => {
              const next = e.target.value
              setBird1(next)
              tryLookup(bird0, next, bird2)
            }}
            className={inputClass}
          />
        </label>
        {threeBird && (
          <label className="flex flex-col items-center gap-1 text-[10px] text-gray-400">
            Bird 2
            <input
              type="number"
              min={1}
              max={25}
              value={bird2}
              onChange={(e) => {
                const next = e.target.value
                setBird2(next)
                tryLookup(bird0, bird1, next)
              }}
              className={inputClass}
            />
          </label>
        )}
      </div>
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={onSetReference}
          className="rounded border border-gray-600 bg-gray-800 px-2 py-0.5 text-[10px] text-gray-200 hover:bg-gray-700"
        >
          Set reference
        </button>
        {!referenceIsWr && (
          <button
            type="button"
            onClick={onResetReference}
            className="text-[10px] text-gray-400 underline hover:text-gray-200"
          >
            Reset to WR
          </button>
        )}
        <p className="text-center text-[9px] text-gray-500">Hold shift on plot</p>
      </div>
      {error && (
        <p className="text-center text-[10px] leading-tight text-red-400">{error}</p>
      )}
    </div>
  )
}

function basePointStyle(zone: Zone, dense: boolean) {
  switch (zone) {
    case 'dominator':
      return { r: 6, fill: '#e74c3c', opacity: 0.9 }
    case 'tradeoff':
      return {
        r: dense ? 4 : 6,
        fill: '#5bc0de',
        opacity: dense ? 0.25 : 0.65,
      }
    case 'wr':
      return { r: 9, fill: '#f0ad4e', opacity: 1 }
    default:
      return {
        r: dense ? 3 : 5,
        fill: '#666666',
        opacity: dense ? 0.12 : 0.35,
      }
  }
}

function selectedPointStyle(zone: Zone) {
  const fill =
    zone === 'wr'
      ? '#f0ad4e'
      : zone === 'dominator'
        ? '#e74c3c'
        : zone === 'tradeoff'
          ? '#5bc0de'
          : '#888888'
  return { r: 9, fill, opacity: 1 }
}

const ScatterCanvas = memo(function ScatterCanvas({
  points,
  plotLeft,
  plotTop,
  plotW,
  plotH,
  onSelect,
}: {
  points: PlotPoint[]
  plotLeft: number
  plotTop: number
  plotW: number
  plotH: number
  onSelect: (simIndex: number) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = W * dpr
    canvas.height = H * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.clearRect(0, 0, W, H)
    ctx.save()
    ctx.beginPath()
    ctx.rect(plotLeft, plotTop, plotW, plotH)
    ctx.clip()
    for (const point of points) {
      const style = basePointStyle(point.zone, true)
      ctx.globalAlpha = style.opacity
      ctx.fillStyle = style.fill
      ctx.beginPath()
      ctx.arc(point.cx, point.cy, style.r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
    ctx.globalAlpha = 1
  }, [points, plotLeft, plotTop, plotW, plotH])

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = ref.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = ((e.clientX - rect.left) / rect.width) * W
    const my = ((e.clientY - rect.top) / rect.height) * H

    let best: PlotPoint | null = null
    let bestDist = 10
    for (const point of points) {
      const dist = Math.hypot(point.cx - mx, point.cy - my)
      if (dist < bestDist) {
        bestDist = dist
        best = point
      }
    }
    if (best) onSelect(best.sim_index)
  }

  return (
    <canvas
      ref={ref}
      className="absolute inset-0 size-full cursor-pointer"
      onClick={handleClick}
    />
  )
})

const ScatterSvg = memo(function ScatterSvg({
  points,
  dense,
  clipId,
  onSelect,
}: {
  points: PlotPoint[]
  dense: boolean
  clipId: string
  onSelect: (simIndex: number) => void
}) {
  return (
    <g clipPath={`url(#${clipId})`}>
      {points.map((point) => {
        const style = basePointStyle(point.zone, dense)
        return (
          <circle
            key={point.sim_index}
            cx={point.cx}
            cy={point.cy}
            r={style.r}
            fill={style.fill}
            fillOpacity={style.opacity}
            className="cursor-pointer"
            onClick={() => onSelect(point.sim_index)}
          />
        )
      })}
    </g>
  )
})

function CyclePanel({
  cycle,
  rows,
  selectedSimIndex,
  reference,
  onSelect,
  onSetReference,
  onResetReference,
}: {
  cycle: number
  rows: DominanceRow[]
  selectedSimIndex: number
  reference: ReferencePoint
  onSelect: (simIndex: number) => void
  onSetReference: (reference: ReferencePoint) => void
  onResetReference: () => void
}) {
  const plotRef = useRef<HTMLDivElement>(null)
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const fullBounds = useMemo(() => boundsFromRows(rows), [rows])
  const fullBoundsRef = useRef(fullBounds)
  const [viewport, setViewport] = useState(() => boundsFromRows(rows))
  const viewportRef = useRef(viewport)

  useEffect(() => {
    fullBoundsRef.current = fullBounds
    viewportRef.current = viewport
  })

  const dense = rows.length > 600
  const wr = rows.find((r) => r.is_wr)
  const displayStats = useMemo(
    () => statsForReference(rows, reference),
    [rows, reference],
  )

  const points = useMemo(() => {
    const xScale = scaleLinear(
      [viewport.xMin, viewport.xMax],
      [PAD.left, PAD.left + plotW],
    )
    const yScale = scaleLinear(
      [viewport.yMin, viewport.yMax],
      [PAD.top + plotH, PAD.top],
    )
    return rows.map((row) => ({
      sim_index: row.sim_index,
      cx: xScale(row.spread),
      cy: yScale(row.frame),
      zone: classifyZone(
        row.frame,
        row.spread,
        reference.frame,
        reference.spread,
        reference.simIndex != null && row.sim_index === reference.simIndex,
      ),
    }))
  }, [rows, reference, viewport, plotW, plotH])

  useEffect(() => {
    const el = plotRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const px = ((e.clientX - rect.left) / rect.width) * W
      const py = ((e.clientY - rect.top) / rect.height) * H
      const current = viewportRef.current
      const { spread, frame } = pixelToData(px, py, current, plotW, plotH)
      const scale = Math.exp(e.deltaY * 0.001)

      setViewport((v) =>
        zoomViewport(v, fullBoundsRef.current, spread, frame, scale),
      )
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [plotW, plotH])

  useEffect(() => {
    const el = plotRef.current
    if (!el) return

    const plotLeft = PAD.left
    const plotRight = PAD.left + plotW
    const plotTop = PAD.top
    const plotBottom = PAD.top + plotH

    let raf = 0
    let pending: ReferencePoint | null = null

    const commit = () => {
      raf = 0
      if (pending) {
        onSetReference(pending)
        pending = null
      }
    }

    const schedule = (ref: ReferencePoint) => {
      pending = ref
      if (!raf) raf = requestAnimationFrame(commit)
    }

    const updateFromClient = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect()
      const px = ((clientX - rect.left) / rect.width) * W
      const py = ((clientY - rect.top) / rect.height) * H
      if (px < plotLeft || px > plotRight || py < plotTop || py > plotBottom) return

      const { spread, frame } = pixelToData(
        px,
        py,
        viewportRef.current,
        plotW,
        plotH,
      )

      schedule({ spread, frame, simIndex: null })
    }

    const lastMouse = { x: 0, y: 0, inPlot: false }

    const onMouseMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect()
      const px = ((e.clientX - rect.left) / rect.width) * W
      const py = ((e.clientY - rect.top) / rect.height) * H
      lastMouse.x = e.clientX
      lastMouse.y = e.clientY
      lastMouse.inPlot =
        px >= plotLeft &&
        px <= plotRight &&
        py >= plotTop &&
        py <= plotBottom

      if (e.shiftKey && lastMouse.inPlot) {
        updateFromClient(e.clientX, e.clientY)
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Shift' || e.repeat) return
      if (lastMouse.inPlot) updateFromClient(lastMouse.x, lastMouse.y)
    }

    el.addEventListener('mousemove', onMouseMove)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      el.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('keydown', onKeyDown)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [plotW, plotH, onSetReference])

  const selected = rows.find((r) => r.sim_index === selectedSimIndex)
  if (!wr || !selected) return null

  const plotLeft = PAD.left
  const plotRight = PAD.left + plotW
  const plotTop = PAD.top
  const plotBottom = PAD.top + plotH

  const selectedPoint = points.find((p) => p.sim_index === selectedSimIndex)
  const selectedZone = selectedPoint?.zone ?? 'tradeoff'
  const selectedStyle = selectedPointStyle(selectedZone)

  const x = scaleLinear(
    [viewport.xMin, viewport.xMax],
    [PAD.left, PAD.left + plotW],
  )
  const y = scaleLinear(
    [viewport.yMin, viewport.yMax],
    [PAD.top + plotH, PAD.top],
  )
  const xTicks = axisTicks(viewport.xMin, viewport.xMax)
  const yTicks = axisTicks(viewport.yMin, viewport.yMax)
  const plotClipId = `plot-clip-${cycle}`
  const overlayClipId = `overlay-clip-${cycle}`

  return (
    <div className="flex items-center gap-1">
      <div
        ref={plotRef}
        className="relative size-[400px] max-w-full shrink-0"
      >
        {dense && (
          <ScatterCanvas
            points={points}
            plotLeft={plotLeft}
            plotTop={plotTop}
            plotW={plotW}
            plotH={plotH}
            onSelect={onSelect}
          />
        )}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className={`relative size-full ${dense ? 'pointer-events-none' : ''}`}
        >
          <defs>
            <clipPath id={plotClipId}>
              <rect x={plotLeft} y={plotTop} width={plotW} height={plotH} />
            </clipPath>
            <clipPath id={overlayClipId}>
              <rect x={plotLeft} y={plotTop} width={plotW} height={plotH} />
            </clipPath>
          </defs>

          <text
            x={W / 2}
            y={16}
            textAnchor="middle"
            className="fill-gray-200 text-[13px] font-medium"
          >
            Cycle {cycle}
          </text>

          <line
            x1={plotLeft}
            x2={plotRight}
            y1={plotBottom}
            y2={plotBottom}
            stroke="#888888"
            strokeWidth={1}
          />
          <line
            x1={plotLeft}
            x2={plotLeft}
            y1={plotTop}
            y2={plotBottom}
            stroke="#888888"
            strokeWidth={1}
          />

          {xTicks.map((tick) => (
            <g key={`x-${tick}`}>
              <line
                x1={x(tick)}
                x2={x(tick)}
                y1={plotBottom}
                y2={plotBottom + 4}
                stroke="#888888"
                strokeWidth={1}
              />
              <text
                x={x(tick)}
                y={plotBottom + 16}
                textAnchor="middle"
                className="fill-gray-400 text-[8px]"
              >
                {formatTick(tick)}
              </text>
            </g>
          ))}

          {yTicks.map((tick) => (
            <g key={`y-${tick}`}>
              <line
                x1={plotLeft - 4}
                x2={plotLeft}
                y1={y(tick)}
                y2={y(tick)}
                stroke="#888888"
                strokeWidth={1}
              />
              <text
                x={plotLeft - 8}
                y={y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-gray-400 text-[8px]"
              >
                {formatTick(tick)}
              </text>
            </g>
          ))}

          {!dense && (
            <ScatterSvg
              points={points}
              dense={dense}
              clipId={plotClipId}
              onSelect={onSelect}
            />
          )}

          <g clipPath={`url(#${overlayClipId})`}>
          {selectedPoint && (
            <circle
              cx={selectedPoint.cx}
              cy={selectedPoint.cy}
              r={selectedStyle.r}
              fill={selectedStyle.fill}
              fillOpacity={selectedStyle.opacity}
              stroke="#ffffff"
              strokeWidth={2}
            />
          )}

          <line
            x1={x(reference.spread)}
            x2={x(reference.spread)}
            y1={PAD.top}
            y2={PAD.top + plotH}
            stroke="#aaaaaa"
            strokeWidth={0.8}
            strokeDasharray="4 3"
          />
          <line
            x1={PAD.left}
            x2={PAD.left + plotW}
            y1={y(reference.frame)}
            y2={y(reference.frame)}
            stroke="#aaaaaa"
            strokeWidth={0.8}
            strokeDasharray="4 3"
          />
          </g>

          <rect
            x={PAD.left + 4}
            y={PAD.top + 4}
            width={168}
            height={52}
            fill="#222222"
            fillOpacity={0.7}
            rx={2}
          />
          <text
            x={PAD.left + 10}
            y={PAD.top + 18}
            className="fill-gray-200 text-[8px]"
          >
            Dominators: {displayStats.n_dominators} ({displayStats.pct_dominators}%)
          </text>
          <text
            x={PAD.left + 10}
            y={PAD.top + 32}
            className="fill-gray-200 text-[8px]"
          >
            Tradeoff: {displayStats.n_tradeoff} ({displayStats.pct_tradeoff}%)
          </text>
          <text
            x={PAD.left + 10}
            y={PAD.top + 46}
            className="fill-gray-200 text-[8px]"
          >
            Dominated: {displayStats.n_dominated} ({displayStats.pct_dominated}%)
          </text>

          <text
            x={W / 2}
            y={H - 4}
            textAnchor="middle"
            className="fill-gray-400 text-[10px]"
          >
            Spread
          </text>
          <text
            x={12}
            y={H / 2}
            textAnchor="middle"
            transform={`rotate(-90 12 ${H / 2})`}
            className="fill-gray-400 text-[10px]"
          >
            Cycle complete frame
          </text>
        </svg>
      </div>
      <DropLookup
        key={selected.sim_index}
        cycle={cycle}
        rows={rows}
        selected={selected}
        onSelect={onSelect}
        onSetReference={() =>
          onSetReference({
            spread: selected.spread,
            frame: selected.frame,
            simIndex: selected.sim_index,
          })
        }
        onResetReference={onResetReference}
        referenceIsWr={reference.simIndex === wr.sim_index}
      />
      <TrajectoryPlayback
        simIndex={selected.sim_index}
        highlightedSlots={rowDropSlots(selected)}
      />
    </div>
  )
}

function defaultWrReference(rows: DominanceRow[], cycles: number[]) {
  const reference: Record<number, ReferencePoint> = {}
  for (const cycle of cycles) {
    const wr = rows.find((r) => r.cycle === cycle && r.is_wr)
    if (wr) {
      reference[cycle] = {
        spread: wr.spread,
        frame: wr.frame,
        simIndex: wr.sim_index,
      }
    }
  }
  return reference
}

export function DominancePlots({
  rows,
}: {
  rows: DominanceRow[]
  stats: DominanceStats[]
}) {
  const cycles = useMemo(() => {
    const set = new Set<number>()
    for (const row of rows) set.add(row.cycle)
    return [...set].sort((a, b) => a - b)
  }, [rows])
  const [selected, setSelected] = useState(() => {
    const refs = defaultWrReference(rows, cycles)
    const sel: Record<number, number> = {}
    for (const cycle of cycles) {
      if (refs[cycle]?.simIndex != null) sel[cycle] = refs[cycle].simIndex!
    }
    return sel
  })
  const [reference, setReference] = useState(() => defaultWrReference(rows, cycles))

  const rowsByCycle = useMemo(() => {
    const map = new Map<number, DominanceRow[]>()
    for (const cycle of cycles) {
      map.set(
        cycle,
        rows.filter((r) => r.cycle === cycle),
      )
    }
    return map
  }, [rows, cycles])

  const handleSelect = useCallback((cycle: number, simIndex: number) => {
    setSelected((prev) => ({ ...prev, [cycle]: simIndex }))
  }, [])

  const handleSetReference = useCallback(
    (cycle: number, ref: ReferencePoint) => {
      setReference((prev) => ({ ...prev, [cycle]: ref }))
    },
    [],
  )

  const handleResetReference = useCallback(
    (cycle: number) => {
      const wr = rows.find((r) => r.cycle === cycle && r.is_wr)
      if (wr) {
        setReference((prev) => ({
          ...prev,
          [cycle]: { spread: wr.spread, frame: wr.frame, simIndex: wr.sim_index },
        }))
      }
    },
    [rows],
  )

  return (
    <div className="flex flex-col items-center gap-6">
      {cycles.map((cycle) => (
        <CyclePanel
          key={cycle}
          cycle={cycle}
          rows={rowsByCycle.get(cycle)!}
          selectedSimIndex={selected[cycle]}
          reference={reference[cycle]}
          onSelect={(simIndex) => handleSelect(cycle, simIndex)}
          onSetReference={(ref) => handleSetReference(cycle, ref)}
          onResetReference={() => handleResetReference(cycle)}
        />
      ))}
    </div>
  )
}
