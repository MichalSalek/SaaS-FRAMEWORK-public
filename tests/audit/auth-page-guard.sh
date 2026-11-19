#!/usr/bin/env bash
# auth-page-guard.sh — AUTHORIZATION: every /app/** page renders a client guard shell (itself or through its direct feature import), verified by import binding and use.
#
# Thin entry point: the logic, its tests and the presence floors live in the
# TypeScript tool(s) below, run with tsx; no awk/grep, so mawk and LC_ALL=C give the same result.
#   tests/audit/tools/auth-page-guard.ts  (tests: tools/auth-page-guard.test.ts)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# `node --import tsx/esm` from the root, not the `tsx` CLI: the CLI's CJS path resolver cannot load
# @mrleebo/prisma-ast (chevrotain has no "exports" main), the ESM loader can.
[[ -d "${ROOT}/node_modules/tsx" ]] || { echo "✗ ${ROOT}/node_modules/tsx missing: run npm install in the repo root" >&2; exit 1; }
cd "$ROOT"
TSX=(node --import tsx/esm)
exec "${TSX[@]}" "${ROOT}/tests/audit/tools/auth-page-guard.ts"
