#!/usr/bin/env bash
# blog-copy-rules.sh — Reguły copy dla wpisów bloga (main/src/content/blog/*.mdx).
#
# RULE (docs/DOMAIN/marketing/COPY_REGISTERS.md): blog to rejestr A, narracja do
# prospektu. Wiążące i sprawdzalne maszynowo są trzy rzeczy:
#
#   1. `author` NIGDY nie jest fikcyjnym działem. SSOT mówi wprost: „etykieta
#      nadawcy = Nailfolio albo ja, nigdy imię", a „zespół / our team /
#      Nailfolio-Team" jest zakazany jako nadawca. To nie jest kosmetyka: pole
#      `author` renderuje się pod tytułem I trafia do JSON-LD, czyli do Google.
#   2. Zero myślników-pauz (— –) w tytule, opisie i treści. Pozycja z listy
#      „Czego NIE pisać".
#   3. Frontmatter kompletny. Brak `description` albo `coverImage` psuje kartę w
#      wynikach i w udostępnieniu, a wychodzi na jaw dopiero po publikacji.
#
# Dlaczego ten strażnik istnieje: przy przeglądzie 2026-09-21 WSZYSTKIE pięć
# wpisów miało zakazane `author: 'Zespół Nailfolio'`, a w treści siedziało 38 pauz.
# Nic tego nie łapało, bo MDX nie przechodzi przez eslint ani przez typy — treść
# była poza siecią. Fallback w blog.utils.ts dopisywał ten sam zakazany label
# każdemu wpisowi bez pola `author`, więc problem odtwarzał się sam.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/_utils.sh"

# Root przez get_project_root, nie z położenia skryptu: inaczej audytu NIE DA
# się sprawdzić fixturami (audit-selftest podstawia mini-projekt przez
# AUDIT_ROOT_OVERRIDE), a strażnik bez dowodu jest wart tyle, co jego regex.
ROOT="$(get_project_root)"
BLOG_DIR="${ROOT}/main/src/content/blog"
VIOLATIONS=0

fail() {
  echo "✗ VIOLATION — $1"
  VIOLATIONS=$((VIOLATIONS + 1))
}

if [ ! -d "${BLOG_DIR}" ]; then
  echo "✓ blog-copy-rules: brak katalogu ${BLOG_DIR} — nic do sprawdzenia"
  exit 0
fi

shopt -s nullglob
POSTS=("${BLOG_DIR}"/*.mdx)
if [ ${#POSTS[@]} -eq 0 ]; then
  echo "✓ blog-copy-rules: brak wpisów — nic do sprawdzenia"
  exit 0
fi

for post in "${POSTS[@]}"; do
  name="$(basename "${post}")"

  # 1. zakazany nadawca (dowolna odmiana „zespół/zespol/team")
  if grep -qiE "^author:.*(zesp[oó][lł]|team)" "${post}"; then
    fail "${name}: pole author to fikcyjny dział. Dozwolone: 'Nailfolio' (COPY_REGISTERS §Kto mówi)"
  fi

  # 2. myślniki-pauzy
  if grep -qP '[\x{2013}\x{2014}]' "${post}"; then
    line="$(grep -nP '[\x{2013}\x{2014}]' "${post}" | head -1 | cut -d: -f1)"
    fail "${name}:${line}: myślnik-pauza (— lub –) — zakazany w copy"
  fi

  # 3. kompletny frontmatter
  for key in title description date category locale author coverImage; do
    if ! grep -qE "^${key}:" "${post}"; then
      fail "${name}: brak pola '${key}' we frontmatterze"
    fi
  done
done

# 4. fallback w kodzie nie może wpisywać zakazanej etykiety
UTILS="${ROOT}/main/src/application/blog/blog.utils.ts"
if [ -f "${UTILS}" ] && grep -qiE "'Zespol Nailfolio'|'Zespół Nailfolio'" "${UTILS}"; then
  fail "blog.utils.ts: fallback pola author wpisuje zakazany label"
fi

if [ ${VIOLATIONS} -gt 0 ]; then
  echo ""
  echo "✗ blog-copy-rules FAILED — ${VIOLATIONS} naruszenie(a)"
  echo "  SSOT: docs/DOMAIN/marketing/COPY_REGISTERS.md"
  exit 1
fi

echo "✓ blog-copy-rules: ${#POSTS[@]} wpisów zgodnych z COPY_REGISTERS"
exit 0
