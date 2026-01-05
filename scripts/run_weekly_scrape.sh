#!/usr/bin/env bash
set -euo pipefail

# Runner script used by GitHub Actions and local cron to perform a download + scrape
# It prefers downloader/run_downloader.mjs if present, otherwise downloader/index.js

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

show_usage() {
  cat <<EOF
Usage: $(basename "$0") [--dry-run] [--limit N]

Options:
  --dry-run    Print actions that would be performed and exit
  --limit N    Limit number of files passed to the scraper (sets MAX_FILES=N)
EOF
}

DRY_RUN=0
LIMIT=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --limit) LIMIT="$2"; shift 2 ;;
    --limit=*) LIMIT="${1#*=}"; shift ;;
    -h|--help) show_usage; exit 0 ;;
    *) echo "Unknown arg: $1"; show_usage; exit 1 ;;
  esac
done

echo "Starting weekly scrape: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "DRY RUN: would run downloader and scraper"
  if [ -f downloader/run_downloader.mjs ]; then
    echo "Would run: node downloader/run_downloader.mjs"
  elif [ -f downloader/index.js ]; then
    echo "Would run: node downloader/index.js"
  else
    echo "No downloader entry script found in downloader/" >&2
  fi
  echo "Would run: RECIPE_DIR=\"$ROOT_DIR/downloader/html\" node scraper/scrape.js"
  if [ "$LIMIT" -ne 0 ]; then
    echo "Would set MAX_FILES=$LIMIT"
  fi
  echo "DRY RUN complete"
  exit 0
fi

if [ -f downloader/run_downloader.mjs ]; then
  echo "Running downloader/run_downloader.mjs"
  node downloader/run_downloader.mjs
elif [ -f downloader/index.js ]; then
  echo "Running downloader/index.js"
  node downloader/index.js
else
  echo "No downloader entry script found in downloader/" >&2
  exit 1
fi

echo "Running scraper"
if [ "$LIMIT" -ne 0 ]; then
  export MAX_FILES="$LIMIT"
  echo "MAX_FILES=$MAX_FILES"
fi
RECIPE_DIR="$ROOT_DIR/downloader/html" node scraper/scrape.js

echo "Completed weekly scrape: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
