#!/usr/bin/env bash
# llms-md-fresh.sh — Guard: markdownowe mirrory stron dla LLM-ów (GEO) są świeże.
#
# INTENT:
#   main/public/{,en/,de/}*.md + llms-full.txt to GENEROWANE mirrory treści stron
#   statycznych (SSOT = i18n common.json ×3 locale), konsumowane przez AI crawlery
#   (ChatGPT/Gemini/Claude/Perplexity) — konwencja llms.txt (https://llmstxt.org).
#   Pliki są commitowane (deploy ich nie buduje). Bez tego guarda zmiana copy w
#   i18n cicho rozjeżdża mirror z treścią strony — dokładnie ta klasa gnicia,
#   która dotknęła llms.txt (4 stale-facts w 6 tygodni, sesja 2026-07-08).
#
# WHAT IT CHECKS:
#   Uruchamia generator w trybie --check (żadnych zapisów): regeneruje treść
#   w pamięci i porównuje z public/. Różnica = FAIL z listą plików STALE.
#
# FIX: cd main && npm run generate:llms-md   (i zacommituj wynik)
#
# EXIT: 0 if PASS (fresh), 1 if stale.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
GENERATOR="${ROOT}/main/scripts/generate-llms-md.mjs"

print_boxed_header "llms-md fresh: markdown mirrors for LLMs match i18n SSOT" "🤖"

if [[ ! -f "$GENERATOR" ]]; then
  print_error "Brak generatora: main/scripts/generate-llms-md.mjs"
  exit 1
fi

if node "$GENERATOR" --check; then
  print_success "llms-md mirrors FRESH (public/*.md zgodne z i18n)"
  exit 0
else
  print_error "llms-md mirrors STALE. Fix: cd main && npm run generate:llms-md (+ commit)"
  exit 1
fi
