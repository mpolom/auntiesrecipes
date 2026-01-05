#!/usr/bin/env bash
set -euo pipefail

# Runner script used by GitHub Actions and local cron to perform a download + scrape
# It prefers downloader/run_downloader.mjs if present, otherwise downloader/index.js

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

echo "Starting weekly scrape: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"

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
RECIPE_DIR="$ROOT_DIR/downloader/html" node scraper/scrape.js

echo "Completed weekly scrape: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
