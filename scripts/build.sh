#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
rm -rf dist
pnpm exec vite build
pnpm exec tsc -p tsconfig.json
chmod +x dist/server/index.js || true
echo "build complete: dist/"
