import { memo, useCallback, useMemo, useRef, useState, useEffect } from 'react'
import type { DominanceRow, DominanceStats, Zone } from './db'
import { rowDropSlots } from './db'
import { ArenaMap } from './ArenaMap'

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

  let next = {
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
  stats,
  selectedSimIndex,
  onSelect,
}: {
  cycle: number
  rows: DominanceRow[]
  stats: DominanceStats
  selectedSimIndex: number
  onSelect: (simIndex: number) => void
}) {
  const plotRef = useRef<HTMLDivElement>(null)
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const fullBounds = useMemo(() => boundsFromRows(rows), [rows])
  const fullBoundsRef = useRef(fullBounds)
  fullBoundsRef.current = fullBounds
  const [viewport, setViewport] = useState(() => boundsFromRows(rows))
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport

  const dense = rows.length > 600

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
      zone: row.zone,
    }))
  }, [rows, viewport, plotW, plotH])

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

  const wr = rows.find((r) => r.zone === 'wr')
  const selected = rows.find((r) => r.sim_index === selectedSimIndex)
  if (!wr || !selected) return null

  const selectedPoint = points.find((p) => p.sim_index === selectedSimIndex)
  const selectedStyle = selectedPointStyle(selected.zone)

  const plotLeft = PAD.left
  const plotRight = PAD.left + plotW
  const plotTop = PAD.top
  const plotBottom = PAD.top + plotH
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
    <div className="flex items-center gap-6">
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
            x1={x(wr.spread)}
            x2={x(wr.spread)}
            y1={PAD.top}
            y2={PAD.top + plotH}
            stroke="#aaaaaa"
            strokeWidth={0.8}
            strokeDasharray="4 3"
          />
          <line
            x1={PAD.left}
            x2={PAD.left + plotW}
            y1={y(wr.frame)}
            y2={y(wr.frame)}
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
            Dominators: {stats.n_dominators} ({stats.pct_dominators}%)
          </text>
          <text
            x={PAD.left + 10}
            y={PAD.top + 32}
            className="fill-gray-200 text-[8px]"
          >
            Tradeoff: {stats.n_tradeoff} ({stats.pct_tradeoff}%)
          </text>
          <text
            x={PAD.left + 10}
            y={PAD.top + 46}
            className="fill-gray-200 text-[8px]"
          >
            Dominated by WR: {stats.n_dominated} ({stats.pct_dominated}%)
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
      <ArenaMap highlightedSlots={rowDropSlots(selected)} />
    </div>
  )
}

function defaultSelection(rows: DominanceRow[], cycles: number[]) {
  const selected: Record<number, number> = {}
  for (const cycle of cycles) {
    const wr = rows.find((r) => r.cycle === cycle && r.is_wr)
    if (wr) selected[cycle] = wr.sim_index
  }
  return selected
}

export function DominancePlots({
  rows,
  stats,
}: {
  rows: DominanceRow[]
  stats: DominanceStats[]
}) {
  const cycles = useMemo(() => stats.map((s) => s.cycle), [stats])
  const [selected, setSelected] = useState(() => defaultSelection(rows, cycles))

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

  return (
    <div className="flex flex-col items-center gap-6">
      {cycles.map((cycle) => (
        <CyclePanel
          key={cycle}
          cycle={cycle}
          rows={rowsByCycle.get(cycle)!}
          stats={stats.find((s) => s.cycle === cycle)!}
          selectedSimIndex={selected[cycle]}
          onSelect={(simIndex) => handleSelect(cycle, simIndex)}
        />
      ))}
    </div>
  )
}
