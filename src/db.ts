import * as duckdb from '@duckdb/duckdb-wasm'
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'
import Worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?worker'

export type Zone = 'dominator' | 'tradeoff' | 'dominated' | 'wr'

export type DominanceRow = {
  sim_index: number
  cycle: number
  spread: number
  frame: number
  bird0_drop: number
  bird1_drop: number
  bird2_drop: number | null
  is_wr: boolean
  zone: Zone
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

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null

function assetUrl(path: string) {
  return new URL(path, window.location.origin).href
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const logger = new duckdb.ConsoleLogger()
      const db = new duckdb.AsyncDuckDB(logger, new Worker())
      await db.instantiate(assetUrl(duckdb_wasm))
      return db
    })()
  }
  return dbPromise
}

async function fetchSql(path: string) {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`Failed to load ${path}`)
  return res.text()
}

export async function loadDominanceData(): Promise<DominanceData> {
  const db = await getDb()
  const conn = await db.connect()

  try {
    const csv = await fetch('/gulp_sweep.csv')
    if (!csv.ok) throw new Error('Failed to load gulp_sweep.csv')
    const buffer = new Uint8Array(await csv.arrayBuffer())
    await db.registerFileBuffer('gulp_sweep.csv', buffer)

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
