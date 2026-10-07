#!/usr/bin/env bash
# Keeps one fleet shard worker alive: checkpoint-resume on each start; 60s pause after 429 / rate-limit exits.
set -euo pipefail
WORK="${1:?work dir}"
SHARD="${2:?shard}"
SHARDS="${3:-4}"
UNIVERSE="${4:-/tmp/gf/universe}"
FLEET="${5:-/tmp/gf/db-fleet}"
EXCLUDE="${6:-azd-2:2023-md-03081}"
CHUNK="${7:-2000}"
HERE="$(cd "$(dirname "$0")" && pwd)"
LOG="$WORK/supervisor.log"
mkdir -p "$WORK"
while true; do
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "{\"event\":\"worker_start\",\"at\":\"$started\",\"shard\":$SHARD}" >> "$LOG"
  set +e
  out="$(mktemp)"
  node "$HERE/docketbird-fleet-worker.mjs" \
    --work="$WORK" --shard="$SHARD" --shards="$SHARDS" --universe="$UNIVERSE" \
    --fleet="$FLEET" --exclude="$EXCLUDE" --chunk="$CHUNK" 2>&1 | tee "$out" | tee -a "$LOG"
  code=$?
  set -e
  reason="$(tail -n 5 "$out" | tr '\n' ' ' | sed 's/"/\\"/g')"
  rm -f "$out"
  echo "{\"event\":\"worker_exit\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"shard\":$SHARD,\"code\":$code,\"reason\":\"$reason\"}" >> "$WORK/exit-history.jsonl"
  if echo "$reason" | grep -qiE 'RATE_LIMIT|429|rate limit'; then
    echo "{\"event\":\"sleep_rate_limit\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"seconds\":60}" >> "$LOG"
    sleep 60
    continue
  fi
  if [[ $code -eq 0 ]]; then
    echo "{\"event\":\"worker_done\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" >> "$LOG"
    break
  fi
  echo "{\"event\":\"sleep_error\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"seconds\":30}" >> "$LOG"
  sleep 30
done
