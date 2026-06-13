import type { DominanceRow, ReferencePoint } from './db'

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
export const defaultPresetId = 'extremely-generous'

export const referencePresets: ReferencePreset[] = [
  {
    id: 'extremely-generous',
    label: 'Set Laughably Generous Calculation',
    points: {
      1: { frame: 120, spread: 7500 },
      2: { frame: 233, spread: 8287 },
      3: { frame: 165, spread: 10650 },
      4: { frame: 285, spread: 10100 },
    },
  },
  // {
  //   id: 'extremely-generous-alt',
  //   label: 'Set Laughably Generous Calculation',
  //   points: {
  //     1: { frame: 118, spread: 7916 },
  //     2: { frame: 235, spread: 10092 },
  //     3: { frame: 168, spread: 11067 },
  //     4: { frame: 285, spread: 10100 },
  //   },
  // },
  {
    id: 'generous',
    label: 'Set Generous Calculation',
    points: {
      1: { frame: 116, spread: 6617 },
      2: { frame: 233, spread: 7517 },
      3: { frame: 163, spread: 10120 },
      4: { frame: 274, spread: 10111 },
    },
  },
  {
    id: 'realistic',
    label: 'Set Realistic Calculation',
    points: {
      1: { frame: 103, spread: 7067 },
      2: { frame: 220, spread: 6660 },
      3: { frame: 145, spread: 10384 },
      4: { frame: 264, spread: 8164 },
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

export function defaultReference(
  rows: DominanceRow[],
  cycles: number[],
): Record<number, ReferencePoint> {
  const preset = referencePresets.find((p) => p.id === defaultPresetId)
  if (preset) return referenceFromPreset(preset, cycles)

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

export function referenceMatchesPreset(
  reference: Record<number, ReferencePoint>,
  preset: ReferencePreset,
  cycles: number[],
): boolean {
  for (const cycle of cycles) {
    const ref = reference[cycle]
    const point = preset.points[cycle]
    if (!ref || !point) return false
    if (ref.simIndex != null) return false
    if (Math.round(ref.frame) !== point.frame) return false
    if (Math.round(ref.spread) !== point.spread) return false
  }
  return true
}

export function referenceMatchesWr(
  reference: Record<number, ReferencePoint>,
  rows: DominanceRow[],
  cycles: number[],
): boolean {
  for (const cycle of cycles) {
    const wr = rows.find((r) => r.cycle === cycle && r.is_wr)
    const ref = reference[cycle]
    if (!wr || !ref) return false
    if (ref.simIndex !== wr.sim_index) return false
    if (ref.frame !== wr.frame) return false
    if (ref.spread !== wr.spread) return false
  }
  return true
}

export function getActiveCalculationId(
  reference: Record<number, ReferencePoint>,
  rows: DominanceRow[],
  cycles: number[],
): string | null {
  if (referenceMatchesWr(reference, rows, cycles)) return 'wr'
  for (const preset of referencePresets) {
    if (referenceMatchesPreset(reference, preset, cycles)) return preset.id
  }
  return null
}

export function formatReferencePresetSnippet(
  cycles: number[],
  reference: Record<number, ReferencePoint>,
  options?: { id?: string; label?: string },
): string {
  const id = options?.id ?? 'my-preset'
  const label = options?.label ?? 'Set My Calculation'
  const pointLines = cycles
    .map((cycle) => {
      const ref = reference[cycle]
      if (!ref) return null
      const frame = Math.round(ref.frame)
      const spread = Math.round(ref.spread)
      return `      ${cycle}: { frame: ${frame}, spread: ${spread} },`
    })
    .filter((line) => line != null)
    .join('\n')

  return `  {
    id: '${id}',
    label: '${label}',
    points: {
${pointLines}
    },
  },`
}
