import { useMemo, useState } from 'react'
import type { DominanceRow, DominanceStats } from './db'
import { rowDropSlots } from './db'
import { ArenaMap } from './ArenaMap'

const PAD = { top: 24, right: 16, bottom: 48, left: 58 }
const W = 400
const H = 400

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

function pointProps(row: DominanceRow, dense: boolean, selected: boolean) {
  if (selected) {
    const fill =
      row.zone === 'wr'
        ? '#f0ad4e'
        : row.zone === 'dominator'
          ? '#e74c3c'
          : row.zone === 'tradeoff'
            ? '#5bc0de'
            : '#888888'
    return { r: 9, fill, opacity: 1, stroke: '#ffffff', strokeWidth: 2 }
  }

  switch (row.zone) {
    case 'dominator':
      return { r: 6, fill: '#e74c3c', opacity: 0.9, stroke: 'none', strokeWidth: 0 }
    case 'tradeoff':
      return {
        r: dense ? 4 : 6,
        fill: '#5bc0de',
        opacity: dense ? 0.25 : 0.65,
        stroke: 'none',
        strokeWidth: 0,
      }
    case 'wr':
      return { r: 9, fill: '#f0ad4e', opacity: 1, stroke: '#ffffff', strokeWidth: 1.5 }
    default:
      return {
        r: dense ? 3 : 5,
        fill: '#666666',
        opacity: dense ? 0.12 : 0.35,
        stroke: 'none',
        strokeWidth: 0,
      }
  }
}

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
  const wr = rows.find((r) => r.zone === 'wr')
  const selected = rows.find((r) => r.sim_index === selectedSimIndex)
  if (!wr || !selected) return null

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const spreads = rows.map((r) => r.spread)
  const frames = rows.map((r) => r.frame)
  const xMin = Math.min(...spreads)
  const xMax = Math.max(...spreads)
  const yMin = Math.min(...frames)
  const yMax = Math.max(...frames)

  const x = scaleLinear([xMin, xMax], [PAD.left, PAD.left + plotW])
  const y = scaleLinear([yMin, yMax], [PAD.top + plotH, PAD.top])

  const dense = rows.length > 600

  const plotLeft = PAD.left
  const plotRight = PAD.left + plotW
  const plotTop = PAD.top
  const plotBottom = PAD.top + plotH
  const xTicks = axisTicks(xMin, xMax)
  const yTicks = axisTicks(yMin, yMax)

  const orderedRows = useMemo(
    () =>
      [...rows].sort((a, b) => {
        if (a.sim_index === selectedSimIndex) return 1
        if (b.sim_index === selectedSimIndex) return -1
        return 0
      }),
    [rows, selectedSimIndex],
  )

  return (
    <div className="flex items-center gap-6">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="size-[400px] max-w-full shrink-0"
      >
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

        {orderedRows.map((row) => {
          const isSelected = row.sim_index === selectedSimIndex
          const props = pointProps(row, dense, isSelected)
          return (
            <circle
              key={row.sim_index}
              cx={x(row.spread)}
              cy={y(row.frame)}
              r={props.r}
              fill={props.fill}
              fillOpacity={props.opacity}
              stroke={props.stroke}
              strokeWidth={props.strokeWidth}
              className="cursor-pointer"
              onClick={() => onSelect(row.sim_index)}
            />
          )
        })}

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
  const cycles = stats.map((s) => s.cycle)
  const [selected, setSelected] = useState(() => defaultSelection(rows, cycles))

  return (
    <div className="flex flex-col items-center gap-6">
      {cycles.map((cycle) => (
        <CyclePanel
          key={cycle}
          cycle={cycle}
          rows={rows.filter((r) => r.cycle === cycle)}
          stats={stats.find((s) => s.cycle === cycle)!}
          selectedSimIndex={selected[cycle]}
          onSelect={(simIndex) =>
            setSelected((prev) => ({ ...prev, [cycle]: simIndex }))
          }
        />
      ))}
    </div>
  )
}
