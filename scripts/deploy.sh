#!/usr/bin/env bash
# Builds the app and force-pushes dist/ to the gh-pages branch that GitHub Pages serves.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
touch dist/.nojekyll
remote=$(git remote get-url origin)
sha=$(git rev-parse --short HEAD)
tmp=$(mktemp -d)
cp -r dist/. "$tmp"
git -C "$tmp" init -q -b gh-pages
git -C "$tmp" add -A
git -C "$tmp" -c user.name=deploy -c user.email=deploy@localhost commit -q -m "deploy $sha"
git -C "$tmp" push -q -f "$remote" gh-pages
rm -rf "$tmp"
echo "deployed $sha to gh-pages"
