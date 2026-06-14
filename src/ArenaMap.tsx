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
import type { BirdAssignment } from './db'

export type BirdPose = {
  bird: number
  x: number
  y: number
  z: number
  yaw: number
}

const DEFAULT_SLOT_FILL = '#5bc0de'

export function ArenaMap({
  birdAssignments = [],
  playbackFrame,
  birds = [],
}: {
  birdAssignments?: BirdAssignment[]
  playbackFrame?: number
  birds?: BirdPose[]
}) {
  const assignmentBySlot = new Map(
    birdAssignments.map((a) => [a.slot, a]),
  )

  return (
    <svg
      viewBox={`0 0 ${ARENA_SIZE} ${ARENA_SIZE}`}
      className="block size-viz w-full max-w-full"
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
        const assignment = assignmentBySlot.get(slot.index)
        const color = assignment ? BIRD_COLORS[assignment.bird] : DEFAULT_SLOT_FILL
        const dropped =
          playbackFrame != null &&
          assignment?.eggSpawnFrame != null &&
          playbackFrame >= assignment.eggSpawnFrame
        return (
          <g key={slot.index}>
            <circle
              cx={x}
              cy={y}
              r={7}
              fill={color}
              stroke={dropped ? '#000000' : assignment ? '#ffffff' : 'none'}
              strokeWidth={dropped ? 3 : assignment ? 2 : 0}
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
