export const DROP_SLOTS = [
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

export const ARENA_SIZE = 400
const PAD = { top: 12, right: 4, bottom: 4, left: 4 }

const cx = DROP_SLOTS.reduce((sum, slot) => sum + slot.x, 0) / DROP_SLOTS.length
const cy = DROP_SLOTS.reduce((sum, slot) => sum + slot.y, 0) / DROP_SLOTS.length
const radius =
  Math.max(...DROP_SLOTS.map((slot) => Math.hypot(slot.x - cx, slot.y - cy))) *
  1.12
const halfExtent = radius * 1.08
const availW = ARENA_SIZE - PAD.left - PAD.right
const availH = ARENA_SIZE - PAD.top - PAD.bottom
const scale = Math.min(availW, availH) / (2 * halfExtent)
const centerX = PAD.left + availW / 2
const centerY = PAD.top + availH / 2
const circleR = radius * scale

export function worldToArena(wx: number, wy: number) {
  return {
    x: centerX + (wx - cx) * scale,
    y: centerY - (wy - cy) * scale,
  }
}

export const arenaCircle = { cx: centerX, cy: centerY, r: circleR }

export const BIRD_COLORS = ['#c0392b', '#1a3a6b', '#27ae60'] as const

export const VULTURE_MAP_MIN_Z = 20000
const SIN_TABLE_SCALE = 4096

export function yawToWorldDir(yaw: number) {
  const idx = yaw & 0xff
  const angle = (idx * 2 * Math.PI) / 256
  return {
    dirX: Math.cos(angle) * SIN_TABLE_SCALE,
    dirY: Math.sin(angle) * SIN_TABLE_SCALE,
  }
}

export function worldDirToArenaDir(dirX: number, dirY: number) {
  const len = Math.hypot(dirX, dirY)
  if (len < 1) return { u: 0, v: -1 }
  return { u: dirX / len, v: -dirY / len }
}

export function birdArrowPoints(
  sx: number,
  sy: number,
  dirX: number,
  dirY: number,
  size: number,
) {
  const { u, v } = worldDirToArenaDir(dirX, dirY)
  const px = -v
  const py = u
  const halfW = size * 0.55
  const tipX = sx + u * size
  const tipY = sy + v * size
  const x1 = sx + px * halfW
  const y1 = sy + py * halfW
  const x2 = sx - px * halfW
  const y2 = sy - py * halfW
  return `${tipX},${tipY} ${x1},${y1} ${x2},${y2}`
}
