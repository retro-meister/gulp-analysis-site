import { memo, useCallback, useMemo, useRef, useState, useEffect, Fragment } from 'react'
import type { DominanceRow, DominanceStats, ReferencePoint, Zone } from './db'
import {
  classifyZone,
  findRowByDrops,
  statsForReference,
} from './db'
import { TrajectoryPlayback } from './TrajectoryPlayback'
import { referenceFromPreset, referencePresets, formatReferencePresetSnippet, defaultReference, getActiveCalculationId } from './referencePresets'
import { formatDisplayFrame } from './cycleFrames'

const PAD = { top: 24, right: 16, bottom: 48, left: 58 }
const W = 400
const H = 400
const LATE_CYCLE_CHANCE_PCT = 38.63

const LATE_CYCLE_WEAPON_CONFIGS = [
  { config: 'bbb', perms: 1, pct: 6.69, tripleable: false },
  { config: 'bbB', perms: 3, pct: 19.58, tripleable: false },
  { config: 'bbR', perms: 3, pct: 9.79, tripleable: false },
  { config: 'bBB', perms: 3, pct: 19.1, tripleable: false },
  { config: 'bBR', perms: 6, pct: 19.1, tripleable: true },
  { config: 'bRR', perms: 3, pct: 4.78, tripleable: true },
  { config: 'BBB', perms: 1, pct: 6.21, tripleable: false },
  { config: 'BBR', perms: 3, pct: 9.32, tripleable: true },
  { config: 'BRR', perms: 3, pct: 4.66, tripleable: true },
  { config: 'RRR', perms: 1, pct: 0.78, tripleable: true },
] as const

function LateCycleChanceLabel() {
  return (
    <span className="group/late relative inline cursor-help bg-[length:5px_2px] bg-bottom bg-repeat-x pb-0.5 transition-colors [background-image:radial-gradient(circle,rgb(107_114_128)_1px,transparent_1px)] hover:text-gray-50 hover:[background-image:radial-gradient(circle,rgb(209_213_219)_1px,transparent_1px)]">
      {LATE_CYCLE_CHANCE_PCT}%
      <span
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-72 -translate-x-1/2 rounded border border-gray-600 bg-gray-950 p-3 text-left text-ui-2sm font-normal normal-case tracking-normal text-gray-300 no-underline shadow-xl group-hover/late:block"
        role="tooltip"
      >
        <p className="text-gray-100">
          b = bomb, B = barrel, R = rocket
        </p>
        <div className="my-2 h-px w-full bg-gray-600" aria-hidden />
        <table className="w-full border-collapse text-ui-xs">
          <thead>
            <tr className="text-gray-100">
              <th className="pb-1 pr-2 text-left font-normal">Config</th>
              <th className="pb-1 pr-2 text-right font-normal">Permutations</th>
              <th className="pb-1 pr-2 text-right font-normal">%</th>
              <th className="pb-1 text-right font-normal">Tripleable</th>
            </tr>
          </thead>
          <tbody>
            {LATE_CYCLE_WEAPON_CONFIGS.map((row) => (
              <tr
                key={row.config}
                className={row.tripleable ? 'text-gray-100' : 'text-gray-500'}
              >
                <td className="py-0.5 pr-2 font-mono">{row.config}</td>
                <td className="py-0.5 pr-2 text-right tabular-nums">{row.perms}</td>
                <td className="py-0.5 pr-2 text-right tabular-nums">
                  {row.pct.toFixed(2)}%
                </td>
                <td className="py-0.5 text-right">{row.tripleable ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-gray-400">
          Tripleable rows sum to {LATE_CYCLE_CHANCE_PCT}%.
        </p>
      </span>
    </span>
  )
}

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

function oneInXFromCount(good: number, total: number): string {
  if (good <= 0) return '—'
  return Math.round(total / good).toLocaleString()
}

function cycleHitProbability(
  stats: DominanceStats,
  totalPermutations: number,
  hasSpecificAssignment: boolean,
): number {
  if (stats.n_dominators > 0) return stats.n_dominators / totalPermutations
  if (hasSpecificAssignment) return 1 / totalPermutations
  return 0
}

function oneInXForCycle(
  stats: DominanceStats,
  totalPermutations: number,
  hasSpecificAssignment: boolean,
): string {
  if (stats.n_dominators > 0) {
    return oneInXFromCount(stats.n_dominators, totalPermutations)
  }
  if (hasSpecificAssignment) return totalPermutations.toLocaleString()
  return '—'
}

function formatCycleOddsFactor(
  stats: DominanceStats,
  totalPermutations: number,
  hasSpecificAssignment: boolean,
): string {
  const x = oneInXForCycle(stats, totalPermutations, hasSpecificAssignment)
  if (x === '—') return '—'
  return `1/${x}`
}

type CycleOddsInput = {
  cycle: number
  stats: DominanceStats
  totalPermutations: number
  hasSpecificAssignment: boolean
}

function combinedDominatorChance(inputs: CycleOddsInput[]): {
  oneInX: string
} {
  let product = 1

  for (const input of inputs) {
    let p = cycleHitProbability(
      input.stats,
      input.totalPermutations,
      input.hasSpecificAssignment,
    )
    if (input.cycle >= 3) {
      p *= LATE_CYCLE_CHANCE_PCT / 100
    }
    product *= p
  }

  return {
    oneInX: product > 0 ? Math.round(1 / product).toLocaleString() : '—',
  }
}

function CombinedOddsExpression({ inputs }: { inputs: CycleOddsInput[] }) {
  return (
    <>
      {inputs.map((input, i) => {
        const factor = formatCycleOddsFactor(
          input.stats,
          input.totalPermutations,
          input.hasSpecificAssignment,
        )
        return (
          <Fragment key={input.cycle}>
            {i > 0 && ' × '}
            {input.cycle >= 3 ? (
              <>
                ({factor} × <LateCycleChanceLabel />)
              </>
            ) : (
              factor
            )}
          </Fragment>
        )
      })}
    </>
  )
}

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
    <label className="flex flex-col items-center gap-1.5 text-ui-sm text-gray-400 min-[1920px]:gap-2 min-[1920px]:text-ui-base">
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
          className="w-10 border-0 bg-transparent px-1 py-1 text-center text-ui-base text-gray-100 outline-none min-[1920px]:w-12 min-[1920px]:py-1.5 min-[1920px]:text-ui-lg"
        />
        <div className="flex w-5 flex-col border-l border-gray-600 min-[1920px]:w-6">
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Increase ${label}`}
            onClick={() => step(1)}
            className={`${stepperBtn} border-b border-gray-600`}
          >
            <svg viewBox="0 0 8 5" className="h-2.5 w-2.5 fill-current min-[1920px]:h-3 min-[1920px]:w-3" aria-hidden>
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
            <svg viewBox="0 0 8 5" className="h-2.5 w-2.5 fill-current min-[1920px]:h-3 min-[1920px]:w-3" aria-hidden>
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
    <div className="flex shrink-0 flex-col items-center gap-2 min-[1920px]:gap-2.5">
      <div className="flex flex-col items-center gap-2 min-[1920px]:gap-2.5">
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
      <div className="flex flex-col items-center gap-1.5 min-[1920px]:gap-2">
        <button
          type="button"
          onClick={onSetReference}
          className="rounded border border-gray-600 bg-gray-800 px-3 py-1 text-ui-base text-gray-200 hover:bg-gray-700 min-[1920px]:px-4 min-[1920px]:py-1.5 min-[1920px]:text-ui-lg"
        >
          Set reference
        </button>
        <button
          type="button"
          onClick={onResetReference}
          disabled={referenceIsWr}
          className="rounded border border-gray-600 bg-gray-800 px-3 py-1 text-ui-base text-gray-200 hover:bg-gray-700 disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-900 disabled:text-gray-500 disabled:hover:bg-gray-900 min-[1920px]:px-4 min-[1920px]:py-1.5 min-[1920px]:text-ui-lg"
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
  onSelect,
}: {
  points: PlotPoint[]
  plotLeft: number
  plotTop: number
  plotW: number
  plotH: number
  svgH: number
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
      ctx.arc(point.cx, point.cy, style.r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
    ctx.globalAlpha = 1
  }, [points, plotLeft, plotTop, plotW, plotH, svgH])

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = ref.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = ((e.clientX - rect.left) / rect.width) * W
    const my = ((e.clientY - rect.top) / rect.height) * svgH

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
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const fullBounds = useMemo(() => boundsFromRows(rows), [rows])
  const fullBoundsRef = useRef(fullBounds)
  const [viewport, setViewport] = useState(fullBounds)
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
      const scale = Math.exp(e.deltaY * 0.001)
      const { spread, frame } = pixelToData(px, py, current, plotW, plotH)
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
  const xTicks = axisTicks(viewport.xMin, viewport.xMax)
  const yTicks = axisTicks(viewport.yMin, viewport.yMax)
  const plotClipId = `plot-clip-${cycle}`
  const overlayClipId = `overlay-clip-${cycle}`

  return (
    <div className="flex w-full flex-col items-center">
      <p className="mb-2 text-ui-lg text-gray-300 min-[1920px]:mb-2.5 min-[1920px]:text-ui-xl">
        1 in{' '}
        <span className="font-semibold text-gray-100">
          {oneInXForCycle(
            displayStats,
            rows.length,
            reference.simIndex != null,
          )}
        </span>
        <span className="text-gray-500">
          {' '}
          ({displayStats.pct_dominators}% dominators)
        </span>
      </p>
      <div className="flex items-center gap-1">
      <div
        ref={plotRef}
        className="relative size-viz max-w-full shrink-0"
      >
        {dense && (
          <ScatterCanvas
            points={points}
            plotLeft={plotLeft}
            plotTop={plotTop}
            plotW={plotW}
            plotH={plotH}
            svgH={H}
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
                {formatDisplayFrame(tick)}
              </text>
            </g>
          ))}

          {reference.spread >= viewport.xMin &&
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

          {reference.frame >= viewport.yMin &&
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
                  {formatDisplayFrame(reference.frame)}
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

          <rect
            x={PAD.left + 4}
            y={PAD.top + 4}
            width={168}
            height={66}
            fill="#222222"
            fillOpacity={0.7}
            rx={2}
          />
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
        key={selected.sim_index}
        simIndex={selected.sim_index}
        selected={selected}
        keyboardActive={keyboardActive}
        onActivate={onActivate}
      />
      </div>
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
  const [reference, setReference] = useState(() => defaultReference(rows, cycles))
  const [activeCycle, setActiveCycle] = useState(() => cycles[0] ?? 1)

  const activeCalculation = useMemo(
    () => getActiveCalculationId(reference, rows, cycles),
    [reference, rows, cycles],
  )

  const calculationButtonClass = (active: boolean) =>
    `rounded border px-4 py-1.5 text-ui-base min-[1920px]:px-5 min-[1920px]:py-2 min-[1920px]:text-ui-lg outline-none focus-visible:ring-1 focus-visible:ring-gray-400 ${
      active
        ? 'border-gray-400 bg-gray-600 text-gray-50'
        : 'border-gray-600 bg-gray-800 text-gray-200 hover:bg-gray-700'
    }`

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'p' && e.key !== 'P') return
      if (!e.shiftKey || !(e.metaKey || e.ctrlKey)) return
      const target = e.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return
      }
      e.preventDefault()
      const snippet = formatReferencePresetSnippet(cycles, reference)
      void navigator.clipboard.writeText(snippet)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cycles, reference])

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

  const handleApplyPreset = useCallback(
    (presetId: string) => {
      const preset = referencePresets.find((p) => p.id === presetId)
      if (!preset) return
      setReference((prev) => ({
        ...prev,
        ...referenceFromPreset(preset, cycles),
      }))
    },
    [cycles],
  )

  const referenceStats = useMemo(
    () =>
      cycles.map((cycle) => ({
        cycle,
        stats: statsForReference(rowsByCycle.get(cycle)!, reference[cycle]),
        totalPermutations: rowsByCycle.get(cycle)!.length,
        hasSpecificAssignment: reference[cycle].simIndex != null,
      })),
    [cycles, rowsByCycle, reference],
  )

  const combined = useMemo(
    () => combinedDominatorChance(referenceStats),
    [referenceStats],
  )

  return (
    <>
      <div className="flex flex-col items-center pb-32 min-[1920px]:pb-44">
        <div className="mb-6 flex flex-wrap items-center justify-center gap-x-1 gap-y-3 min-[1920px]:mb-8 min-[1920px]:gap-y-4">
        {referencePresets.map((preset, i) => (
          <Fragment key={preset.id}>
            {i > 0 && (
              <div
                className="mx-2 h-4 w-px shrink-0 bg-gray-600 min-[1920px]:h-6"
                aria-hidden
              />
            )}
            <button
              type="button"
              onClick={(e) => {
                handleApplyPreset(preset.id)
                e.currentTarget.blur()
              }}
              className={calculationButtonClass(activeCalculation === preset.id)}
            >
              {preset.label}
            </button>
          </Fragment>
        ))}
      </div>
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
      {cycles.length > 0 && (
        <div className="mt-8 w-full max-w-2xl border-t border-gray-600 pt-6 text-center">
          <p className="text-ui-md font-semibold uppercase tracking-wider text-gray-200">
            All cycles back to back calculation:
          </p>
          <p className="mt-2 text-ui-lg text-gray-200">
            <CombinedOddsExpression inputs={referenceStats} /> ={' '}
            <span className="font-semibold text-gray-50">
              1 in {combined.oneInX}
            </span>
          </p>
        </div>
      )}
      </div>
      {cycles.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-gray-500 bg-[#1c1d24]/98 px-4 py-4 shadow-[0_-12px_40px_rgba(0,0,0,0.55)] backdrop-blur-sm min-[1920px]:px-8 min-[1920px]:py-5">
          <div className="mx-auto max-w-5xl text-center min-[1920px]:max-w-7xl">
            <p className="text-ui-lg font-bold uppercase tracking-widest text-gray-50">
              Total probability calculation:
            </p>
            <p className="mt-2 text-ui-lg leading-snug text-gray-200">
              <CombinedOddsExpression inputs={referenceStats} /> ={' '}
              <span className="text-ui-xl font-bold text-white">
                1 in {combined.oneInX}
              </span>
            </p>
          </div>
        </div>
      )}
    </>
  )
}
