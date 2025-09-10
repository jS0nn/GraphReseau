#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Load .env.dev if present to populate SHEET_ID_DEFAULT and SITE_ID_FILTER_DEFAULT
if [[ -f "$ROOT_DIR/.env.dev" ]]; then
  # Export variables defined in .env.dev
  set -a
  # shellcheck disable=SC1090
  . "$ROOT_DIR/.env.dev"
  set +a
fi

SOURCE_SHEET_ID_DEFAULT="1gDB6Y8NbaNl_ZWgAlrdMlAQ41AekYdIca6eexkzxQkw"
SRC_ID="${SOURCE_SHEET_ID:-$SOURCE_SHEET_ID_DEFAULT}"
DEST_ID="${SHEET_ID_DEFAULT:-}"
SITE_FILTER="${SITE_ID_FILTER:-${SITE_ID_FILTER_DEFAULT:-}}"

if [[ -z "$DEST_ID" ]]; then
  echo "Error: SHEET_ID_DEFAULT is not set (destination sheet). Export it or set it in .env.dev." >&2
  exit 1
fi

CMD=( python "$ROOT_DIR/scripts/migrate_nodes_from_sheet.py" --source-sheet-id "$SRC_ID" --dest-sheet-id "$DEST_ID" )
if [[ -n "$SITE_FILTER" ]]; then
  CMD+=( --site-id-filter "$SITE_FILTER" )
fi

echo "Running: ${CMD[*]}" >&2
exec "${CMD[@]}"

