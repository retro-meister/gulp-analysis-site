import { memo, useCallback, useMemo, useRef, useState, useEffect } from 'react'
import type { DominanceRow, DominanceStats, ReferencePoint, Zone } from './db'
import {
  classifyZone,
  findRowByDrops,
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

function formatPercentTick(v: number): string {
  return `${Math.round(v)}%`
}

type ViewMode = '2d' | '1d'

type PercentileData = {
  standardized: Map<number, number>
}

function percentileForValue(values: number[], value: number): number {
  const n = values.length
  if (n === 0) return 50
  if (n === 1) return 50
  let less = 0
  let equal = 0
  for (const v of values) {
    if (v < value) less++
    else if (v === value) equal++
  }
  const rank = less + (equal > 0 ? (equal - 1) / 2 : 0)
  return (rank / (n - 1)) * 100
}

function buildPercentileData(rows: DominanceRow[]): PercentileData {
  const spreads = rows.map((r) => r.spread)
  const frames = rows.map((r) => r.frame)
  const standardized = new Map<number, number>()
  for (const row of rows) {
    const spreadPct = percentileForValue(spreads, row.spread)
    const framePct = percentileForValue(frames, row.frame)
    standardized.set(row.sim_index, (spreadPct + framePct) / 2)
  }
  return { standardized }
}

function referenceStandardizedPercentile(
  reference: ReferencePoint,
  rows: DominanceRow[],
  percentiles: PercentileData,
): number {
  if (
    reference.simIndex != null &&
    percentiles.standardized.has(reference.simIndex)
  ) {
    return percentiles.standardized.get(reference.simIndex)!
  }
  const spreads = rows.map((r) => r.spread)
  const frames = rows.map((r) => r.frame)
  return (
    (percentileForValue(spreads, reference.spread) +
      percentileForValue(frames, reference.frame)) /
    2
  )
}

function classifyZone1d(
  pointPct: number,
  refPct: number,
  isReference: boolean,
): Zone {
  if (isReference) return 'wr'
  if (pointPct < refPct - 0.05) return 'dominator'
  if (pointPct > refPct + 0.05) return 'dominated'
  return 'tradeoff'
}

type Stats1d = {
  refPct: number
  selectedPct: number
  wrPct: number
  nBetter: number
  nWorse: number
  pctBetter: number
  pctWorse: number
}

function statsFor1d(
  rows: DominanceRow[],
  reference: ReferencePoint,
  selectedSimIndex: number,
  percentiles: PercentileData,
  refStdPct: number,
  wrSimIndex: number,
): Stats1d {
  let nBetter = 0
  let nWorse = 0
  const comparable =
    reference.simIndex != null ? rows.length - 1 : rows.length

  for (const row of rows) {
    if (reference.simIndex != null && row.sim_index === reference.simIndex) {
      continue
    }
    const pct = percentiles.standardized.get(row.sim_index) ?? 50
    if (pct < refStdPct - 0.05) nBetter++
    else if (pct > refStdPct + 0.05) nWorse++
  }

  const pct = (n: number) =>
    comparable === 0 ? 0 : Math.round((1000 * n) / comparable) / 10

  return {
    refPct: refStdPct,
    selectedPct: percentiles.standardized.get(selectedSimIndex) ?? 50,
    wrPct: percentiles.standardized.get(wrSimIndex) ?? 50,
    nBetter,
    nWorse,
    pctBetter: pct(nBetter),
    pctWorse: pct(nWorse),
  }
}

const BOUNDS_1D: Viewport = { xMin: -2, xMax: 102, yMin: 0, yMax: 1 }

function parseDropSlot(value: string): number | null {
  const n = Number.parseInt(value.trim(), 10)
  if (!Number.isInteger(n) || n < 1 || n > 25) return null
  return n
}

function filterDropSlotInput(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits === '') return null
  if (digits.length > 2) return null
  const n = Number.parseInt(digits, 10)
  if (!Number.isInteger(n) || n < 1 || n > 25) return null
  return digits
}

function wrapDropSlot(n: number, delta: number): number {
  return ((n - 1 + delta + 25) % 25) + 1
}

function dropSlotStep(value: string, delta: number): string {
  const parsed = parseDropSlot(value)
  const base = parsed ?? (delta > 0 ? 25 : 1)
  return String(wrapDropSlot(base, delta))
}

function DropSlotInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (next: string) => void
}) {
  const step = (delta: number) => {
    onChange(dropSlotStep(value, delta))
  }

  const stepperBtn =
    'flex flex-1 items-center justify-center bg-gray-800 text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-100 active:bg-gray-600'

  return (
    <label className="flex flex-col items-center gap-1 text-[10px] text-gray-400">
      {label}
      <div className="flex overflow-hidden rounded border border-gray-600 bg-gray-900">
        <input
          type="text"
          inputMode="numeric"
          pattern="[1-9]|1[0-9]|2[0-5]"
          value={value}
          onChange={(e) => {
            const next = filterDropSlotInput(e.target.value)
            if (next != null) onChange(next)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              step(1)
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              step(-1)
            }
          }}
          className="w-9 border-0 bg-transparent px-1 py-0.5 text-center text-xs text-gray-100 outline-none"
        />
        <div className="flex w-4 flex-col border-l border-gray-600">
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Increase ${label}`}
            onClick={() => step(1)}
            className={`${stepperBtn} border-b border-gray-600`}
          >
            <svg viewBox="0 0 8 5" className="h-2 w-2 fill-current" aria-hidden>
              <path d="M4 0 8 5H0Z" />
            </svg>
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Decrease ${label}`}
            onClick={() => step(-1)}
            className={stepperBtn}
          >
            <svg viewBox="0 0 8 5" className="h-2 w-2 fill-current" aria-hidden>
              <path d="M0 0h8L4 5Z" />
            </svg>
          </button>
        </div>
      </div>
    </label>
  )
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
  const [prevSimIndex, setPrevSimIndex] = useState(selected.sim_index)
  const [pendingLookupSim, setPendingLookupSim] = useState<number | null>(null)

  if (selected.sim_index !== prevSimIndex) {
    setPrevSimIndex(selected.sim_index)
    if (pendingLookupSim !== selected.sim_index) {
      setBird0(String(selected.bird0_drop))
      setBird1(String(selected.bird1_drop))
      setBird2(selected.bird2_drop != null ? String(selected.bird2_drop) : '')
    }
    if (pendingLookupSim != null) {
      setPendingLookupSim(null)
    }
  }

  const tryLookup = (nextBird0: string, nextBird1: string, nextBird2: string) => {
    const b0 = parseDropSlot(nextBird0)
    const b1 = parseDropSlot(nextBird1)
    const b2 = threeBird ? parseDropSlot(nextBird2) : null

    if (b0 == null || b1 == null || (threeBird && b2 == null)) {
      return
    }

    const row = findRowByDrops(rows, b0, b1, b2)
    if (!row) return

    setPendingLookupSim(row.sim_index)
    onSelect(row.sim_index)
  }

  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <div className="flex flex-col items-center gap-1.5">
        <DropSlotInput
          label="Bird 0"
          value={bird0}
          onChange={(next) => {
            setBird0(next)
            tryLookup(next, bird1, bird2)
          }}
        />
        <DropSlotInput
          label="Bird 1"
          value={bird1}
          onChange={(next) => {
            setBird1(next)
            tryLookup(bird0, next, bird2)
          }}
        />
        {threeBird && (
          <DropSlotInput
            label="Bird 2"
            value={bird2}
            onChange={(next) => {
              setBird2(next)
              tryLookup(bird0, bird1, next)
            }}
          />
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
        <button
          type="button"
          onClick={onResetReference}
          disabled={referenceIsWr}
          className="rounded border border-gray-600 bg-gray-800 px-2 py-0.5 text-[10px] text-gray-200 hover:bg-gray-700 disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-900 disabled:text-gray-500 disabled:hover:bg-gray-900"
        >
          Reset to WR
        </button>
      </div>
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
  svgH,
  oneD = false,
  onSelect,
}: {
  points: PlotPoint[]
  plotLeft: number
  plotTop: number
  plotW: number
  plotH: number
  svgH: number
  oneD?: boolean
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
    canvas.height = svgH * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.clearRect(0, 0, W, svgH)
    ctx.save()
    ctx.beginPath()
    ctx.rect(plotLeft, plotTop, plotW, plotH)
    ctx.clip()
    for (const point of points) {
      const style = basePointStyle(point.zone, true)
      ctx.globalAlpha = style.opacity
      ctx.fillStyle = style.fill
      ctx.beginPath()
      ctx.arc(point.cx, point.cy, oneD ? Math.min(style.r, 4) : style.r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
    ctx.globalAlpha = 1
  }, [points, plotLeft, plotTop, plotW, plotH, svgH, oneD])

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = ref.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = ((e.clientX - rect.left) / rect.width) * W
    const my = ((e.clientY - rect.top) / rect.height) * svgH

    let best: PlotPoint | null = null
    let bestDist = oneD ? 14 : 10
    for (const point of points) {
      const dist = oneD
        ? Math.abs(point.cx - mx)
        : Math.hypot(point.cx - mx, point.cy - my)
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
  keyboardActive,
  onActivate,
  onSelect,
  onSetReference,
  onResetReference,
}: {
  cycle: number
  rows: DominanceRow[]
  selectedSimIndex: number
  reference: ReferencePoint
  keyboardActive: boolean
  onActivate: () => void
  onSelect: (simIndex: number) => void
  onSetReference: (reference: ReferencePoint) => void
  onResetReference: () => void
}) {
  const plotRef = useRef<HTMLDivElement>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('2d')
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const lineY = PAD.top + plotH / 2

  const fullBounds2d = useMemo(() => boundsFromRows(rows), [rows])
  const fullBounds = viewMode === '2d' ? fullBounds2d : BOUNDS_1D
  const fullBoundsRef = useRef(fullBounds)
  const [viewport2d, setViewport2d] = useState(fullBounds2d)
  const [viewport1d, setViewport1d] = useState(BOUNDS_1D)
  const viewport = viewMode === '2d' ? viewport2d : viewport1d
  const viewportRef = useRef(viewport)
  const viewModeRef = useRef(viewMode)
  const percentiles = useMemo(() => buildPercentileData(rows), [rows])

  useEffect(() => {
    fullBoundsRef.current = fullBounds
    viewportRef.current = viewport
    viewModeRef.current = viewMode
  })

  const dense = rows.length > 600
  const wr = rows.find((r) => r.is_wr)
  const displayStats = useMemo(
    () => statsForReference(rows, reference),
    [rows, reference],
  )
  const refStdPct = useMemo(
    () => referenceStandardizedPercentile(reference, rows, percentiles),
    [reference, rows, percentiles],
  )
  const stats1d = useMemo(
    () =>
      wr
        ? statsFor1d(
            rows,
            reference,
            selectedSimIndex,
            percentiles,
            refStdPct,
            wr.sim_index,
          )
        : null,
    [rows, reference, selectedSimIndex, percentiles, refStdPct, wr],
  )

  const points = useMemo(() => {
    if (viewMode === '1d') {
      const xScale = scaleLinear(
        [viewport.xMin, viewport.xMax],
        [PAD.left, PAD.left + plotW],
      )
      return rows.map((row) => {
        const stdPct = percentiles.standardized.get(row.sim_index) ?? 50
        return {
          sim_index: row.sim_index,
          cx: xScale(stdPct),
          cy: lineY,
          zone: row.is_wr
            ? 'wr'
            : classifyZone1d(stdPct, refStdPct, false),
        }
      })
    }

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
      zone: row.is_wr
        ? 'wr'
        : classifyZone(
            row.frame,
            row.spread,
            reference.frame,
            reference.spread,
            false,
          ),
    }))
  }, [rows, reference, viewport, plotW, plotH, lineY, viewMode, percentiles, refStdPct])

  useEffect(() => {
    const el = plotRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const px = ((e.clientX - rect.left) / rect.width) * W
      const py = ((e.clientY - rect.top) / rect.height) * H
      const current = viewportRef.current
      const scale = Math.exp(e.deltaY * 0.001)

      if (viewModeRef.current === '1d') {
        const xRatio = (px - PAD.left) / plotW
        const anchorX =
          current.xMin + xRatio * (current.xMax - current.xMin)
        setViewport1d((v) => {
          const xSpan = v.xMax - v.xMin
          const newXSpan = xSpan * scale
          const xRatio2 = (anchorX - v.xMin) / (xSpan || 1)
          const next = {
            ...v,
            xMin: anchorX - newXSpan * xRatio2,
            xMax: anchorX + newXSpan * (1 - xRatio2),
          }
          return clampViewport(next, fullBoundsRef.current)
        })
        return
      }

      const { spread, frame } = pixelToData(px, py, current, plotW, plotH)
      setViewport2d((v) =>
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
      if (viewModeRef.current === '1d') return
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
  const referenceIsWr =
    reference.simIndex === wr.sim_index ||
    (spansEqual(reference.spread, wr.spread) && reference.frame === wr.frame)

  const x = scaleLinear(
    [viewport.xMin, viewport.xMax],
    [PAD.left, PAD.left + plotW],
  )
  const y = scaleLinear(
    [viewport.yMin, viewport.yMax],
    [PAD.top + plotH, PAD.top],
  )
  const xTicks =
    viewMode === '1d'
      ? axisTicks(Math.max(0, viewport.xMin), Math.min(100, viewport.xMax))
      : axisTicks(viewport.xMin, viewport.xMax)
  const yTicks = viewMode === '2d' ? axisTicks(viewport.yMin, viewport.yMax) : []
  const plotClipId = `plot-clip-${cycle}`
  const overlayClipId = `overlay-clip-${cycle}`
  const toggleClass = (active: boolean) =>
    `px-1.5 py-0.5 ${active ? 'bg-gray-700 text-gray-100' : 'bg-gray-900 text-gray-500 hover:text-gray-300'}`

  return (
    <div className="flex items-center gap-1">
      <div
        ref={plotRef}
        className="relative size-[400px] max-w-full shrink-0"
      >
        <div className="absolute top-1 right-1.5 z-10 flex overflow-hidden rounded border border-gray-600 text-[9px]">
          <button
            type="button"
            onClick={() => setViewMode('2d')}
            className={toggleClass(viewMode === '2d')}
          >
            2D
          </button>
          <button
            type="button"
            onClick={() => setViewMode('1d')}
            className={toggleClass(viewMode === '1d')}
          >
            1D
          </button>
        </div>
        {dense && (
          <ScatterCanvas
            points={points}
            plotLeft={plotLeft}
            plotTop={plotTop}
            plotW={plotW}
            plotH={plotH}
            svgH={H}
            oneD={viewMode === '1d'}
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
            Cycle {cycle} ({rows.length.toLocaleString()} permutations)
          </text>

          <line
            x1={plotLeft}
            x2={plotRight}
            y1={plotBottom}
            y2={plotBottom}
            stroke="#888888"
            strokeWidth={1}
          />
          {viewMode === '1d' && (
            <line
              x1={plotLeft}
              x2={plotRight}
              y1={lineY}
              y2={lineY}
              stroke="#666666"
              strokeWidth={1.5}
            />
          )}
          {viewMode === '2d' && (
            <line
              x1={plotLeft}
              x2={plotLeft}
              y1={plotTop}
              y2={plotBottom}
              stroke="#888888"
              strokeWidth={1}
            />
          )}

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
                {viewMode === '1d' ? formatPercentTick(tick) : formatTick(tick)}
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

          {viewMode === '2d' &&
            reference.spread >= viewport.xMin &&
            reference.spread <= viewport.xMax && (
              <g>
                <line
                  x1={x(reference.spread)}
                  x2={x(reference.spread)}
                  y1={plotBottom}
                  y2={plotBottom + 6}
                  stroke="#aaaaaa"
                  strokeWidth={1.25}
                />
                <text
                  x={x(reference.spread)}
                  y={plotBottom + 16}
                  textAnchor="middle"
                  className="fill-gray-300 text-[8px] font-medium"
                >
                  {formatTick(reference.spread)}
                </text>
              </g>
            )}

          {viewMode === '2d' &&
            reference.frame >= viewport.yMin &&
            reference.frame <= viewport.yMax && (
              <g>
                <line
                  x1={plotLeft - 6}
                  x2={plotLeft}
                  y1={y(reference.frame)}
                  y2={y(reference.frame)}
                  stroke="#aaaaaa"
                  strokeWidth={1.25}
                />
                <text
                  x={plotLeft - 10}
                  y={y(reference.frame)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-gray-300 text-[8px] font-medium"
                >
                  {formatTick(reference.frame)}
                </text>
              </g>
            )}

          {viewMode === '1d' &&
            refStdPct >= viewport.xMin &&
            refStdPct <= viewport.xMax && (
              <g>
                <line
                  x1={x(refStdPct)}
                  x2={x(refStdPct)}
                  y1={plotBottom}
                  y2={plotBottom + 6}
                  stroke="#aaaaaa"
                  strokeWidth={1.25}
                />
                <text
                  x={x(refStdPct)}
                  y={plotBottom + 16}
                  textAnchor="middle"
                  className="fill-gray-300 text-[8px] font-medium"
                >
                  {formatPercentTick(refStdPct)}
                </text>
              </g>
            )}

          {!dense && (
            <ScatterSvg
              points={points}
              dense={dense}
              clipId={plotClipId}
              onSelect={onSelect}
            />
          )}

          {viewMode === '2d' && (
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
                y1={plotTop}
                y2={plotBottom}
                stroke="#aaaaaa"
                strokeWidth={0.8}
                strokeDasharray="4 3"
              />
              <line
                x1={plotLeft}
                x2={plotRight}
                y1={y(reference.frame)}
                y2={y(reference.frame)}
                stroke="#aaaaaa"
                strokeWidth={0.8}
                strokeDasharray="4 3"
              />
            </g>
          )}

          {viewMode === '1d' && (
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
                x1={x(refStdPct)}
                x2={x(refStdPct)}
                y1={plotTop}
                y2={plotBottom}
                stroke="#aaaaaa"
                strokeWidth={0.8}
                strokeDasharray="4 3"
              />
            </g>
          )}

          <rect
            x={PAD.left + 4}
            y={PAD.top + 4}
            width={168}
            height={66}
            fill="#222222"
            fillOpacity={0.7}
            rx={2}
          />
          {viewMode === '2d' ? (
            <>
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
            </>
          ) : stats1d && (
            <>
              <text
                x={PAD.left + 10}
                y={PAD.top + 16}
                className="fill-gray-200 text-[8px]"
              >
                Ref: {formatPercentTick(stats1d.refPct)}
              </text>
              <text
                x={PAD.left + 10}
                y={PAD.top + 28}
                className="fill-gray-200 text-[8px]"
              >
                Selected: {formatPercentTick(stats1d.selectedPct)}
              </text>
              <text
                x={PAD.left + 10}
                y={PAD.top + 40}
                className="fill-gray-200 text-[8px]"
              >
                WR: {formatPercentTick(stats1d.wrPct)}
              </text>
              <text
                x={PAD.left + 10}
                y={PAD.top + 52}
                className="fill-gray-200 text-[8px]"
              >
                Better: {stats1d.nBetter.toLocaleString()} ({stats1d.pctBetter}%)
              </text>
              <text
                x={PAD.left + 10}
                y={PAD.top + 64}
                className="fill-gray-200 text-[8px]"
              >
                Worse: {stats1d.nWorse.toLocaleString()} ({stats1d.pctWorse}%)
              </text>
            </>
          )}

          <text
            x={W / 2}
            y={H - 4}
            textAnchor="middle"
            className="fill-gray-400 text-[10px]"
          >
            {viewMode === '1d' ? 'Standardized percentile' : 'Spread'}
          </text>
          {viewMode === '2d' && (
            <text
              x={12}
              y={H / 2}
              textAnchor="middle"
              transform={`rotate(-90 12 ${H / 2})`}
              className="fill-gray-400 text-[10px]"
            >
              Cycle complete frame
            </text>
          )}
        </svg>
      </div>
      <DropLookup
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
        referenceIsWr={referenceIsWr}
      />
      <TrajectoryPlayback
        simIndex={selected.sim_index}
        selected={selected}
        keyboardActive={keyboardActive}
        onActivate={onActivate}
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
  const [activeCycle, setActiveCycle] = useState(() => cycles[0] ?? 1)

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
    setActiveCycle(cycle)
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
        setActiveCycle(cycle)
        setSelected((prev) => ({ ...prev, [cycle]: wr.sim_index }))
        setReference((prev) => ({
          ...prev,
          [cycle]: { spread: wr.spread, frame: wr.frame, simIndex: wr.sim_index },
        }))
      }
    },
    [rows],
  )

  return (
    <div className="flex flex-col items-center">
      {cycles.map((cycle, i) => (
        <div key={cycle} className="flex w-full flex-col items-center">
          {i > 0 && <div className="my-6 h-px w-full bg-gray-600" />}
          <CyclePanel
            cycle={cycle}
            rows={rowsByCycle.get(cycle)!}
            selectedSimIndex={selected[cycle]}
            reference={reference[cycle]}
            keyboardActive={activeCycle === cycle}
            onActivate={() => setActiveCycle(cycle)}
            onSelect={(simIndex) => handleSelect(cycle, simIndex)}
            onSetReference={(ref) => handleSetReference(cycle, ref)}
            onResetReference={() => handleResetReference(cycle)}
          />
        </div>
      ))}
    </div>
  )
}
