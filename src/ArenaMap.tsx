const DROP_SLOTS = [
  { index: 1, x: 40960, y: 36864 },
  { index: 2, x: 41574, y: 42189 },
  { index: 3, x: 39844, y: 45394 },
  { index: 4, x: 32768, y: 43008 },
  { index: 5, x: 34816, y: 36864 },
  { index: 6, x: 36741, y: 34621 },
  { index: 7, x: 32061, y: 39567 },
  { index: 8, x: 33997, y: 47104 },
  { index: 9, x: 37274, y: 50022 },
  { index: 10, x: 44298, y: 45517 },
  { index: 11, x: 45414, y: 42506 },
  { index: 12, x: 43868, y: 37540 },
  { index: 13, x: 42660, y: 33536 },
  { index: 14, x: 39055, y: 31805 },
  { index: 15, x: 31805, y: 34826 },
  { index: 16, x: 28928, y: 38574 },
  { index: 17, x: 29327, y: 42516 },
  { index: 18, x: 30536, y: 46930 },
  { index: 19, x: 33628, y: 49060 },
  { index: 20, x: 34673, y: 32317 },
  { index: 21, x: 36864, y: 44237 },
  { index: 22, x: 38502, y: 38912 },
  { index: 23, x: 46080, y: 39885 },
  { index: 24, x: 27935, y: 45394 },
  { index: 25, x: 41288, y: 49551 },
] as const

const SIZE = 400
const SVG_PAD = 18

const cx = DROP_SLOTS.reduce((sum, slot) => sum + slot.x, 0) / DROP_SLOTS.length
const cy = DROP_SLOTS.reduce((sum, slot) => sum + slot.y, 0) / DROP_SLOTS.length
const radius =
  Math.max(...DROP_SLOTS.map((slot) => Math.hypot(slot.x - cx, slot.y - cy))) *
  1.12
const halfExtent = radius * 1.08
const plotSize = SIZE - 2 * SVG_PAD
const scale = plotSize / (2 * halfExtent)
const center = SIZE / 2

function toSvg(wx: number, wy: number) {
  return {
    x: center + (wx - cx) * scale,
    y: center - (wy - cy) * scale,
  }
}

export function ArenaMap({ highlightedSlots }: { highlightedSlots: number[] }) {
  const highlighted = new Set(highlightedSlots)
  const circleR = radius * scale

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-[400px] max-w-full shrink-0">
      <circle
        cx={center}
        cy={center}
        r={circleR}
        fill="none"
        stroke="#ffffff"
        strokeWidth={1.25}
      />
      {DROP_SLOTS.map((slot) => {
        const { x, y } = toSvg(slot.x, slot.y)
        const active = highlighted.has(slot.index)
        return (
          <g key={slot.index}>
            <circle
              cx={x}
              cy={y}
              r={7}
              fill={active ? '#f0ad4e' : '#5bc0de'}
              stroke={active ? '#ffffff' : 'none'}
              strokeWidth={active ? 2 : 0}
            />
            <text
              x={x}
              y={y - 10}
              textAnchor="middle"
              dominantBaseline="auto"
              className="fill-gray-200 text-[11px]"
            >
              {slot.index}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
