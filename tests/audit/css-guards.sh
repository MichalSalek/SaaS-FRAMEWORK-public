#!/usr/bin/env bash
# css-guards.sh — the CSS design-system guards over main.
#
# PostCSS rules in `main/css-rules/rules/` (Stylelint was rejected: see the DECISION in
# main/css-rules/engine.mjs), each with its root, presence floor, path assertions and escape
# markers; the TSX halves of the same rules are `nf/*` ESLint rules run by lint-guards.sh.
# Contrast itself is a browser measurement (`npm run qa:contrast`), not a static promise.
# Tests: `npx vitest run css-rules` in main/. Run alone: `node main/css-rules/run.mjs`.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNNER="${ROOT}/main/css-rules/run.mjs"
[[ -f "$RUNNER" ]] || { echo "✗ missing ${RUNNER}" >&2; exit 1; }
exec node "$RUNNER"
