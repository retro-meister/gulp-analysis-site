import * as duckdb from '@duckdb/duckdb-wasm'
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'
import Worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?worker'
import { loadAssetBytes, loadTotalBytes } from 'virtual:load-sizes'

export type Zone = 'dominator' | 'tradeoff' | 'dominated' | 'wr'

export type DominanceRow = {
  sim_index: number
  cycle: number
  spread: number
  frame: number
  bird0_drop: number
  bird1_drop: number
  bird2_drop: number | null
  bird0_egg_spawn_frame: number | null
  bird1_egg_spawn_frame: number | null
  bird2_egg_spawn_frame: number | null
  is_wr: boolean
  zone: Zone
}

export type BirdAssignment = {
  bird: number
  slot: number
  eggSpawnFrame: number | null
}

export function rowBirdAssignments(row: DominanceRow): BirdAssignment[] {
  const assignments: BirdAssignment[] = [
    {
      bird: 0,
      slot: row.bird0_drop,
      eggSpawnFrame: row.bird0_egg_spawn_frame,
    },
    {
      bird: 1,
      slot: row.bird1_drop,
      eggSpawnFrame: row.bird1_egg_spawn_frame,
    },
  ]
  if (row.bird2_drop != null) {
    assignments.push({
      bird: 2,
      slot: row.bird2_drop,
      eggSpawnFrame: row.bird2_egg_spawn_frame,
    })
  }
  return assignments
}

export function rowDropSlots(row: DominanceRow): number[] {
  const slots = [row.bird0_drop, row.bird1_drop]
  if (row.bird2_drop != null) slots.push(row.bird2_drop)
  return slots
}

export function findRowByDrops(
  rows: DominanceRow[],
  bird0: number,
  bird1: number,
  bird2: number | null,
): DominanceRow | undefined {
  return rows.find(
    (r) =>
      r.bird0_drop === bird0 &&
      r.bird1_drop === bird1 &&
      (bird2 == null ? r.bird2_drop == null : r.bird2_drop === bird2),
  )
}

export function classifyZone(
  frame: number,
  spread: number,
  refFrame: number,
  refSpread: number,
  isReference: boolean,
): Zone {
  if (isReference) return 'wr'
  if (frame < refFrame && spread < refSpread) return 'dominator'
  if (frame > refFrame && spread > refSpread) return 'dominated'
  return 'tradeoff'
}

export type ReferencePoint = {
  spread: number
  frame: number
  simIndex: number | null
}

export function statsForReference(
  rows: DominanceRow[],
  ref: ReferencePoint,
): DominanceStats {
  let n_dominators = 0
  let n_tradeoff = 0
  let n_dominated = 0
  for (const row of rows) {
    if (ref.simIndex != null && row.sim_index === ref.simIndex) continue
    const zone = classifyZone(row.frame, row.spread, ref.frame, ref.spread, false)
    if (zone === 'dominator') n_dominators++
    else if (zone === 'tradeoff') n_tradeoff++
    else n_dominated++
  }

  const n_assignments = ref.simIndex != null ? rows.length - 1 : rows.length
  const pct = (n: number) =>
    n_assignments === 0
      ? 0
      : Math.round((1000 * n) / n_assignments) / 10

  return {
    cycle: rows[0]?.cycle ?? 0,
    n_assignments,
    n_dominators,
    n_tradeoff,
    n_dominated,
    pct_dominators: pct(n_dominators),
    pct_tradeoff: pct(n_tradeoff),
    pct_dominated: pct(n_dominated),
  }
}

export type DominanceStats = {
  cycle: number
  n_assignments: number
  n_dominators: number
  n_tradeoff: number
  n_dominated: number
  pct_dominators: number
  pct_tradeoff: number
  pct_dominated: number
}

export type DominanceData = {
  rows: DominanceRow[]
  stats: DominanceStats[]
}

export type TrajectoryBird = {
  bird: number
  x: number
  y: number
  z: number
  yaw: number
}

export type TrajectoryData = {
  maxFrame: number
  frames: Map<number, TrajectoryBird[]>
}

export type LoadProgress = {
  phase: 'duckdb' | 'sweep' | 'trajectories' | 'queries'
  label: string
  loaded: number
  total: number | null
  overallLoaded: number
  overallTotal: number | null
}

class LoadTracker {
  private completedBytes = 0
  private onProgress?: (progress: LoadProgress) => void

  constructor(onProgress?: (progress: LoadProgress) => void) {
    this.onProgress = onProgress
    if (onProgress) {
      onProgress({
        phase: 'duckdb',
        label: 'Loading DuckDB engine…',
        loaded: 0,
        total: loadAssetBytes.duckdb,
        overallLoaded: 0,
        overallTotal: loadTotalBytes,
      })
    }
  }

  private emit(
    phase: LoadProgress['phase'],
    label: string,
    loaded: number,
    total: number,
    fileLoaded: number,
  ) {
    this.onProgress?.({
      phase,
      label,
      loaded,
      total,
      overallLoaded: this.completedBytes + fileLoaded,
      overallTotal: loadTotalBytes,
    })
  }

  startPhase(phase: LoadProgress['phase'], label: string) {
    this.emit(phase, label, 0, loadTotalBytes, 0)
  }

  async fetchBytes(
    url: string,
    phase: LoadProgress['phase'],
    label: string,
    knownSize: number,
  ): Promise<Uint8Array> {
    const resolved = new URL(url, window.location.origin).href
    const res = await fetch(resolved)
    if (!res.ok) throw new Error(`Failed to load ${url}`)

    if (!res.body || !this.onProgress) {
      const buffer = new Uint8Array(await res.arrayBuffer())
      this.completedBytes += buffer.byteLength
      this.emit(phase, label, buffer.byteLength, knownSize, 0)
      return buffer
    }

    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let loaded = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loaded += value.length
      this.emit(phase, label, loaded, knownSize, loaded)
    }

    const buffer = new Uint8Array(loaded)
    let offset = 0
    for (const chunk of chunks) {
      buffer.set(chunk, offset)
      offset += chunk.length
    }

    this.completedBytes += loaded
    this.emit(phase, label, loaded, knownSize, 0)
    return buffer
  }
}

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null
let trajectoriesReady: Promise<void> | null = null
const trajectoryCache = new Map<number, TrajectoryData>()

async function createDb(tracker?: LoadTracker): Promise<duckdb.AsyncDuckDB> {
  const logger = new duckdb.ConsoleLogger()
  const db = new duckdb.AsyncDuckDB(logger, new Worker())
  const wasm = await (tracker?.fetchBytes(
    duckdb_wasm,
    'duckdb',
    'Loading DuckDB engine…',
    loadAssetBytes.duckdb,
  ) ?? fetch(duckdb_wasm).then(async (res) => {
    if (!res.ok) throw new Error('Failed to load DuckDB WASM')
    return new Uint8Array(await res.arrayBuffer())
  }))
  const wasmUrl = URL.createObjectURL(
    new Blob([Uint8Array.from(wasm)], { type: 'application/wasm' }),
  )
  try {
    await db.instantiate(wasmUrl)
  } finally {
    URL.revokeObjectURL(wasmUrl)
  }
  return db
}

async function getDb(tracker?: LoadTracker) {
  if (!dbPromise) {
    dbPromise = createDb(tracker)
  }
  return dbPromise
}

async function fetchSql(path: string) {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`Failed to load ${path}`)
  return res.text()
}

export async function loadDominanceData(
  onProgress?: (progress: LoadProgress) => void,
): Promise<DominanceData> {
  const tracker = new LoadTracker(onProgress)
  const db = await getDb(tracker)
  const conn = await db.connect()

  try {
    const sweepBuffer = await tracker.fetchBytes(
      '/gulp_sweep.csv',
      'sweep',
      'Loading sweep data…',
      loadAssetBytes.sweep,
    )
    await db.registerFileBuffer('gulp_sweep.csv', sweepBuffer)

    if (!trajectoriesReady) {
      trajectoriesReady = (async () => {
        const parquetBuffer = await tracker.fetchBytes(
          '/gulp_trajectories.parquet',
          'trajectories',
          'Loading trajectory data…',
          loadAssetBytes.trajectories,
        )
        await db.registerFileBuffer('gulp_trajectories.parquet', parquetBuffer)
      })()
    }
    await trajectoriesReady

    tracker.startPhase('queries', 'Analyzing data…')

    await conn.query(await fetchSql('/sql/load.sql'))

    const dominance = await conn.query(await fetchSql('/sql/cycle_dominance.sql'))
    const stats = await conn.query(await fetchSql('/sql/cycle_dominance_stats.sql'))

    return {
      rows: dominance.toArray().map((row) => ({
        sim_index: Number(row.sim_index),
        cycle: Number(row.cycle),
        spread: Number(row.spread),
        frame: Number(row.frame),
        bird0_drop: Number(row.bird0_drop),
        bird1_drop: Number(row.bird1_drop),
        bird2_drop:
          row.bird2_drop == null ? null : Number(row.bird2_drop),
        bird0_egg_spawn_frame:
          row.bird0_egg_spawn_frame == null
            ? null
            : Number(row.bird0_egg_spawn_frame),
        bird1_egg_spawn_frame:
          row.bird1_egg_spawn_frame == null
            ? null
            : Number(row.bird1_egg_spawn_frame),
        bird2_egg_spawn_frame:
          row.bird2_egg_spawn_frame == null
            ? null
            : Number(row.bird2_egg_spawn_frame),
        is_wr: Boolean(row.is_wr),
        zone: row.zone as Zone,
      })),
      stats: stats.toArray().map((row) => ({
        cycle: Number(row.cycle),
        n_assignments: Number(row.n_assignments),
        n_dominators: Number(row.n_dominators),
        n_tradeoff: Number(row.n_tradeoff),
        n_dominated: Number(row.n_dominated),
        pct_dominators: Number(row.pct_dominators),
        pct_tradeoff: Number(row.pct_tradeoff),
        pct_dominated: Number(row.pct_dominated),
      })),
    }
  } finally {
    await conn.close()
  }
}

async function ensureTrajectoriesLoaded() {
  if (!trajectoriesReady) {
    trajectoriesReady = (async () => {
      const db = await getDb()
      const res = await fetch('/gulp_trajectories.parquet')
      if (!res.ok) throw new Error('Failed to load gulp_trajectories.parquet')
      const buffer = new Uint8Array(await res.arrayBuffer())
      await db.registerFileBuffer('gulp_trajectories.parquet', buffer)
    })()
  }
  await trajectoriesReady
}

export async function loadTrajectory(simIndex: number): Promise<TrajectoryData> {
  const cached = trajectoryCache.get(simIndex)
  if (cached) return cached

  await ensureTrajectoriesLoaded()
  const db = await getDb()
  const conn = await db.connect()

  try {
    const result = await conn.query(
      `SELECT frame, bird, x, y, z, yaw
       FROM read_parquet('gulp_trajectories.parquet')
       WHERE sim_index = ${simIndex}
       ORDER BY frame, bird`,
    )

    const frames = new Map<number, TrajectoryBird[]>()
    let maxFrame = 0
    for (const row of result.toArray()) {
      const frame = Number(row.frame)
      maxFrame = Math.max(maxFrame, frame)
      const birds = frames.get(frame) ?? []
      birds.push({
        bird: Number(row.bird),
        x: Number(row.x),
        y: Number(row.y),
        z: Number(row.z),
        yaw: Number(row.yaw),
      })
      frames.set(frame, birds)
    }

    const data: TrajectoryData = { maxFrame, frames }
    trajectoryCache.set(simIndex, data)
    return data
  } finally {
    await conn.close()
  }
}
