#!/usr/bin/env bash
# Source from repo root (or after `cd` to repo root). Exports DATABASE_URL when found.
load_database_url() {
  local f line val
  # Already set in the environment (e.g. Render, CI)? Use it as-is.
  if [ -n "${DATABASE_URL:-}" ]; then
    return 0
  fi
  for f in .env.local .env; do
    [ -f "$f" ] || continue
    line=$(grep -E '^[[:space:]]*DATABASE_URL=' "$f" | tail -n1) || true
    if [ -n "$line" ]; then
      val="${line#*=}"
      val="${val%$'\r'}"
      val="${val#\"}"
      val="${val%\"}"
      val="${val#\'}"
      val="${val%\'}"
      export DATABASE_URL="$val"
      return 0
    fi
  done
  return 1
}
