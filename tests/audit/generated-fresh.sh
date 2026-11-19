#!/usr/bin/env bash
# generated-fresh.sh — Contract registries, the OpenAPI map and the llms markdown mirrors equal a fresh run of their generators (check mode or temp output, never writes the repo).
#
# Thin entry point: the logic, its tests and the presence floors live in the
# TypeScript tool(s) below, run with tsx; no awk/grep, so mawk and LC_ALL=C give the same result.
#   tests/audit/tools/generated-fresh.ts  (tests: tools/generated-fresh.test.ts)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# `node --import tsx/esm` from the root, not the `tsx` CLI: the CLI's CJS path resolver cannot load
# @mrleebo/prisma-ast (chevrotain has no "exports" main), the ESM loader can.
[[ -d "${ROOT}/node_modules/tsx" ]] || { echo "✗ ${ROOT}/node_modules/tsx missing: run npm install in the repo root" >&2; exit 1; }
cd "$ROOT"
TSX=(node --import tsx/esm)
exec "${TSX[@]}" "${ROOT}/tests/audit/tools/generated-fresh.ts"
