#!/usr/bin/env bash
# pagination.sh — Paginated Prisma reads sorted by a non-unique field carry a unique tiebreaker; capped findMany in email code orders deterministically.
# Thin entry point: the logic, its tests and the presence floors live in the
# TypeScript tool(s) below, run with tsx; no awk/grep, so mawk and LC_ALL=C give the same result.
# TypeScript tool(s) below, run with tsx; no awk/grep, so mawk and LC_ALL=C give the same result.
#   tests/audit/tools/pagination.ts  (tests: tools/pagination.test.ts)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# `node --import tsx/esm` from the root, not the `tsx` CLI: the CLI's CJS path resolver cannot load
# @mrleebo/prisma-ast (chevrotain has no "exports" main), the ESM loader can.
[[ -d "${ROOT}/node_modules/tsx" ]] || { echo "✗ ${ROOT}/node_modules/tsx missing: run npm install in the repo root" >&2; exit 1; }
cd "$ROOT"
TSX=(node --import tsx/esm)
exec "${TSX[@]}" "${ROOT}/tests/audit/tools/pagination.ts"
