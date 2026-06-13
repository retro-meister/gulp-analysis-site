export const CYCLE_FRAME_OFFSET = 50

export function toDisplayFrame(raw: number): number {
  return Math.max(1, raw - CYCLE_FRAME_OFFSET)
}

export function toRawFrame(display: number): number {
  return display + CYCLE_FRAME_OFFSET
}

export function formatDisplayFrame(raw: number): string {
  return Math.round(toDisplayFrame(raw)).toLocaleString()
}
