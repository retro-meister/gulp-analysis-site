import type { ReferencePoint } from './db'

export type ReferencePresetPoint = {
  frame: number
  spread: number
}

export type ReferencePreset = {
  id: string
  label: string
  points: Record<number, ReferencePresetPoint>
}

export const wrCalculationLabel = 'Set WR Calculation'

export const referencePresets: ReferencePreset[] = [
  {
    id: 'generous',
    label: 'Set Generous Calculation',
    points: {
      1: { frame: 120, spread: 7500 },
      2: { frame: 233, spread: 8287 },
      3: { frame: 165, spread: 10650 },
      4: { frame: 285, spread: 10100 },
    },
  },
]

export function referenceFromPreset(
  preset: ReferencePreset,
  cycles: number[],
): Record<number, ReferencePoint> {
  const reference: Record<number, ReferencePoint> = {}
  for (const cycle of cycles) {
    const point = preset.points[cycle]
    if (!point) continue
    reference[cycle] = {
      spread: point.spread,
      frame: point.frame,
      simIndex: null,
    }
  }
  return reference
}
