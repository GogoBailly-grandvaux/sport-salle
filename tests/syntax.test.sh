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
# cohérence des versions : js/version.js doit matcher sw.js (source unique affichée)
APPV=$(grep -o "APP_VERSION = '[^']*'" js/version.js | cut -d"'" -f2)
SWV=$(grep -o "VERSION = 'v[^']*'" sw.js | cut -d"'" -f2)
if [ "v$APPV" != "$SWV" ]; then echo "✗ versions désynchronisées : version.js=$APPV vs sw.js=$SWV"; fail=1; fi

[ "$fail" = 0 ] && echo "✓ syntaxe OK ($(find js -name '*.js' | wc -l | tr -d ' ') modules + sw.js)"
exit "$fail"
