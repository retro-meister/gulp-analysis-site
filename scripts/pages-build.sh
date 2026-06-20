#!/bin/sh
set -e

if [ "$CF_PAGES_BRANCH" = "private-placeholder" ]; then
  rm -rf dist
  mkdir -p dist
  cp placeholder/index.html dist/index.html
else
  pnpm exec tsc -b
  pnpm exec vite build
fi
