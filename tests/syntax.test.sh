#!/usr/bin/env bash
# Vérifie la syntaxe de tous les modules JS + du service worker.
set -euo pipefail
cd "$(dirname "$0")/.."
printf '{"type":"module"}' > package.json
trap 'rm -f package.json' EXIT
fail=0
while IFS= read -r f; do
  if ! node --check "$f"; then echo "✗ $f"; fail=1; fi
done < <(find js -name '*.js'; echo sw.js)
[ "$fail" = 0 ] && echo "✓ syntaxe OK ($(find js -name '*.js' | wc -l | tr -d ' ') modules + sw.js)"
exit "$fail"
