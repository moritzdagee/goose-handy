#!/usr/bin/env bash
# Legt den fertigen Bau (webapp/dist) als einzigen Stand auf den Zweig gh-pages.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DIST="$HERE/webapp/dist"
[[ -f "$DIST/index.html" ]] || { echo "erst bauen: cd webapp && npm run build" >&2; exit 1; }
TMP="$(mktemp -d)"
cp -R "$DIST/." "$TMP/"
touch "$TMP/.nojekyll"
cd "$TMP"
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C "$HERE" config user.name)" -c user.email="$(git -C "$HERE" config user.email)" \
  commit -qm "Bau $(date -u +%Y-%m-%dT%H:%MZ) von $(git -C "$HERE" rev-parse --short HEAD)"
git push -qf "$(git -C "$HERE" remote get-url origin)" gh-pages:gh-pages
echo "veroeffentlicht: https://moritzdagee.github.io/goose-handy/"
