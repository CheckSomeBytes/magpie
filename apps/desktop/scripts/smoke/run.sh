#!/usr/bin/env bash
# End-to-end smoke tests: drive the built app over the Chrome DevTools Protocol
# with fake capture sources (no portal or real screen needed).
#
#   npm run build -w magpie && apps/desktop/scripts/smoke/run.sh [editor|library|scroll|phase4|video ...]
#
# Needs a display (X11/Wayland/WSLg). Screenshots and logs go to $SMOKE_DIR.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$HERE/../.." && pwd)"
SMOKE_DIR="${SMOKE_DIR:-$(mktemp -d -t magpie-smoke-XXXX)}"
FFLATE="$(cd "$APP/../.." && pwd)/node_modules/fflate"
mkdir -p "$SMOKE_DIR"
[ -f "$SMOKE_DIR/test.magpie" ] || node "$HERE/make-test-magpie.cjs" "$FFLATE" "$SMOKE_DIR/test.magpie"
[ -f "$SMOKE_DIR/tall.png" ] || node "$HERE/make-tall.mjs" "$SMOKE_DIR/tall.png"
suites=("${@:-editor library scroll phase4 video}")
for s in ${suites[@]}; do
  case "$s" in
    editor) driver=drive.mjs ;;
    library) driver=drive-library.mjs ;;
    scroll) driver=drive-scroll.mjs ;;
    *) driver="drive-$s.mjs" ;;
  esac
  rm -rf "$SMOKE_DIR/config"
  echo "== $s"
  node "$HERE/$driver" "$APP" "$SMOKE_DIR"
done
echo "artifacts: $SMOKE_DIR"
