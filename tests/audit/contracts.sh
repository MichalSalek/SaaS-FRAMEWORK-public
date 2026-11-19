#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
exec node --import tsx/esm tests/audit/tools/d1-contracts.ts
