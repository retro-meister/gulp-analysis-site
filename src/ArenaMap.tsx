import {
  ARENA_SIZE,
  arenaCircle,
  BIRD_COLORS,
  birdArrowPoints,
  DROP_SLOTS,
  VULTURE_MAP_MIN_Z,
  worldToArena,
  yawToWorldDir,
} from './arenaProjection'

export type BirdPose = {
  bird: number
  x: number
  y: number
  z: number
  yaw: number
}

export function ArenaMap({
  highlightedSlots,
  birds = [],
}: {
  highlightedSlots: number[]
  birds?: BirdPose[]
}) {
  const highlighted = new Set(highlightedSlots)

  return (
    <svg
      viewBox={`0 0 ${ARENA_SIZE} ${ARENA_SIZE}`}
      className="block max-w-full shrink-0"
      style={{ width: ARENA_SIZE, height: ARENA_SIZE }}
    >
      <circle
        cx={arenaCircle.cx}
        cy={arenaCircle.cy}
        r={arenaCircle.r}
        fill="none"
        stroke="#ffffff"
        strokeWidth={1.25}
      />
      {DROP_SLOTS.map((slot) => {
        const { x, y } = worldToArena(slot.x, slot.y)
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
      {birds.map((bird) => {
        if (bird.z < VULTURE_MAP_MIN_Z) return null
        const { x, y } = worldToArena(bird.x, bird.y)
        const { dirX, dirY } = yawToWorldDir(bird.yaw)
        const color = BIRD_COLORS[bird.bird] ?? '#ffffff'
        return (
          <polygon
            key={bird.bird}
            points={birdArrowPoints(x, y, dirX, dirY, 14)}
            fill={color}
            stroke="#ffffff"
            strokeWidth={1}
          />
        )
      })}
    </svg>
  )
}
