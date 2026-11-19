#!/usr/bin/env bash
# stripe.sh — Stripe semantics: claim-first in the webhook transaction, no Stripe API on the in-transaction path (helpers followed), every list/search scoped to this product, ui_mode 'custom'.
#
# Thin entry point: the logic, its tests and the presence floors live in the
# TypeScript tool(s) below, run with tsx; no awk/grep, so mawk and LC_ALL=C give the same result.
#   tests/audit/tools/stripe.ts  (tests: tools/stripe.test.ts)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# `node --import tsx/esm` from the root, not the `tsx` CLI: the CLI's CJS path resolver cannot load
# @mrleebo/prisma-ast (chevrotain has no "exports" main), the ESM loader can.
[[ -d "${ROOT}/node_modules/tsx" ]] || { echo "✗ ${ROOT}/node_modules/tsx missing: run npm install in the repo root" >&2; exit 1; }
cd "$ROOT"
TSX=(node --import tsx/esm)
exec "${TSX[@]}" "${ROOT}/tests/audit/tools/stripe.ts"
