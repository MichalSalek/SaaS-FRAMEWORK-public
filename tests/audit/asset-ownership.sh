#!/usr/bin/env bash
# asset-ownership.sh — OWNERSHIP: every web-1 domain file that persists a Cloudinary public_id calls findForeignAssetOwner (or documents why), so nobody can claim another user's file.
#
# Thin entry point: the logic, its tests and the presence floors live in the
# TypeScript tool(s) below, run with tsx; no awk/grep, so mawk and LC_ALL=C give the same result.
#   tests/audit/tools/asset-ownership.ts  (tests: tools/asset-ownership.test.ts)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# `node --import tsx/esm` from the root, not the `tsx` CLI: the CLI's CJS path resolver cannot load
# @mrleebo/prisma-ast (chevrotain has no "exports" main), the ESM loader can.
[[ -d "${ROOT}/node_modules/tsx" ]] || { echo "✗ ${ROOT}/node_modules/tsx missing: run npm install in the repo root" >&2; exit 1; }
cd "$ROOT"
TSX=(node --import tsx/esm)
exec "${TSX[@]}" "${ROOT}/tests/audit/tools/asset-ownership.ts"
