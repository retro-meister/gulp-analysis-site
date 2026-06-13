#!/usr/bin/env sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CSV="$ROOT/public/gulp_trajectories.csv"
OUT="$ROOT/public/gulp_trajectories.parquet"
if [ ! -f "$CSV" ]; then
  echo "Missing $CSV"
  exit 1
fi
duckdb -c "COPY (SELECT * FROM read_csv_auto('$CSV')) TO '$OUT' (FORMAT PARQUET, COMPRESSION ZSTD);"
ls -lh "$OUT"
