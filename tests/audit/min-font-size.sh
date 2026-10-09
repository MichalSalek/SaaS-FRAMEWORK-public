#!/usr/bin/env bash
# min-font-size.sh — Enforce the 16px floor for RAW font sizes (inline styles and CSS) in main/src.
#
# RULE (DESIGN.md → Typografia): rozmiary czcionek biorą się z type-scale tokenów
# `--text-*` (baza `--text-base` = 16px). Surowa wartość px < 16 to naruszenie
# dostępności/estetyki. Podłoga samej skali tokenów to 14px (`--text-xs`, DECISION S37
# w tokens.css), więc rozmiar poniżej 16px jest legalny wyłącznie jako token `--text-*`,
# nigdy jako surowa liczba. Ten skrypt sprawdza surowe wartości, nie tokeny.
#
# Dlaczego ten audyt istnieje: produkt trzyma się tokenów, ale strony self-contained
# (archetyp /dev — inline style, własny dark theme) omijały ten system i przemycały
# raw px < 16 (np. fontSize: 12). Nic tego nie łapało → luka. Ten strażnik ją zamyka
# dla KAŻDEJ sesji dotykającej main/src.
#
# CHECK: żaden plik .ts/.tsx/.css pod main/src nie może zawierać:
#   · inline `fontSize: <N>`     gdzie N < 16   (obiekt stylu React)
#   · CSS `font-size: <N>px`     gdzie N < 16   (stringi CSS + CSS modules)
# Produkt jest czysty (0 inline px) — patrz allowlist: tylko istniejące strony /dev
# są grandfatherowane (nie moja robota do przepisania); NOWE muszą trzymać floor.
#
# S76: rozszerzony o --include=*.css — badge dzwoneczka z raw font-size: 11px
# przeszedł pre-commit na zielono, bo strażnik skanował TYLKO ts/tsx (inline),
# a CSS modules były poza siecią. tokens.css (definicje skali, DECISION S37)
# jest na allowliście — to SSOT skali, nie użycie.
#
# S98: rozszerzony o JEDNOSTKI RELATYWNE PONIŻEJ 1 (`0.85em`, `.9em`, `0.875rem`,
# `85%`). Skan px był ślepy na cały ten zapis, a to on przemycał najmniejsze
# czcionki w produkcie. Zakaz obejmuje CAŁĄ trójkę, ale z DWÓCH różnych powodów
# — i warto je rozróżniać, bo inaczej uzasadnienie jest fałszywe dla jednej
# trzeciej wyliczenia:
#   · `em` i `%` liczą się od ODZIEDZICZONEGO rozmiaru rodzica, więc ten sam
#     zapis daje inny wynik w każdym kontekście i nie da się go ocenić wzrokiem.
#     Zmierzone przed zaciśnięciem: `.filterChipCount` 0.78em na rodzicu
#     --text-sm = 11,7px · `.cookieName` 0.85em na tabeli --text-sm = 12,75px ·
#     `.newsletterConsent` 0.85em (zgoda RODO!) = 13,6px · `.diagnosticSep`
#     0.6em = 8,4px. Wszystkie przechodziły na zielono.
#   · `rem` liczy się od KORZENIA, więc jest przewidywalny (0.875rem to stałe
#     14px) — i właśnie dlatego jest zbędny: 14px to dokładnie token --text-xs.
#     Zapis rem omija skalę typograficzną, nie kontekst.
# Reguła jedna dla wszystkich: rozmiar bierze się z tokenu --text-*.
#
# S100b: rozszerzony o WNETRZE `clamp()` / `min()` / `max()`. Gałąź grepowa
# wymaga cyfry albo cudzysłowu zaraz po dwukropku, więc `font-size: clamp(12px,
# 0.95vw, 14px)` przechodziła na zielono — a to zapis, w którym podłoga jest
# DOKŁADNIE tym, czego ten strażnik pilnuje, tylko schowanym o jeden nawias
# głębiej. Znaleziony przypadek (`.useCaseDetail` na ForStudios) renderował
# 12px na każdym telefonie, bo `0.95vw` przy 390px to 3,7px i wynik siadał na
# podłodze. Podłoga wewnątrz funkcji jest ta sama co na zewnątrz — 16px — i to
# nie jest przeoczenie względem skali, tylko jej konsekwencja: `--text-xs` (14px,
# DECISION S37) jest legalny jako TOKEN, nie jako surowa liczba. Rozluźnienie do
# 14 wewnątrz nawiasu otwierałoby furtkę, w której `clamp(14px, 1vw, 14px)` to
# stałe 14px przechodzące na zielono, podczas gdy gołe `14px` obok pada. Kto
# potrzebuje czternastki, bierze `--text-xs`; kto potrzebuje płynnej — `--text-fluid-xs`.
# Ta gałąź jest parserem w node, nie regexem: trzeba wyłuskać KAŻDĄ długość
# z wnętrza funkcji i wziąć najmniejszą, a tego jednym wyrażeniem się nie robi.
#
# S100: rozszerzony o zapisy inline w CUDZYSŁOWIE. Gałąź inline wymagała gołej
# cyfry zaraz po dwukropku (`fontSize: 12`), a gałąź cudzysłowowa akceptowała
# WYŁĄCZNIE em/rem — więc `fontSize: '12px'` i `fontSize: '85%'` przechodziły
# na zielono. To nie jest przypadek teoretyczny: zapis w cudzysłowie to żywy
# idiom w tym repo (buildery kart OG w pages/api/og — tam wszystkie wartości
# są >= 20px i mają przechodzić dalej).
set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SRC_DIR="${ROOT}/main/src"

# ── Grandfathered: pre-istniejące self-contained strony /dev (inline raw px sprzed
# tej reguły). Ścieżki względem ROOT. NOWE strony /dev NIE są tu dopisywane —
# floor 16px obowiązuje je od startu. api.tsx świadomie POZA allowlistą.
GRANDFATHERED=(
  "main/src/pages/dev/architecture.tsx"
  "main/src/pages/dev/index.tsx"
  "main/src/pages/dev/playground.tsx"
  "main/src/pages/dev/ui.tsx"
  # SSOT type-scale — definicje tokenów (nie użycia); DECISION S37 w pliku.
  "main/src/UI/styles/tokens.css"
)

print_boxed_header "Min font-size: 16px floor (inline styles, main/src)" "🔠"

# N < 16 = 0–9 (jednocyfrowe) lub 10–15 (1[0-5]), z opcjonalną częścią dziesiętną.
# Trailing `[,} ]` (inline) / `px` (CSS) gwarantuje, że 16/17/… NIE łapią.
# Człon relatywny: część całkowita musi być pusta albo `0`, więc `1.5em` / `2rem`
# (świadome powiększenia, np. dropcap `4.2em`) NIE łapią — tylko zapisy < 1.
# Człony CUDZYSŁOWOWE (`fontSize: '12px'`, `fontSize: '85%'`): ten sam floor
# dla zapisu, w którym wartość jest stringiem — bez nich gałąź inline widziała
# wyłącznie gołą cyfrę, a cudzysłowowa wyłącznie em/rem (S100).
PATTERN='(fontSize: ?(1[0-5]|[0-9])(\.[0-9]+)?[,} ])|(font-size: ?(1[0-5]|[0-9])(\.[0-9]+)?px)|(font-size: ?0?\.[0-9]+(em|rem))|(fontSize: ?['"'"'\"]0?\.[0-9]+(em|rem))|(font-size: ?[0-9]{1,2}%)|(fontSize: ?['"'"'\"](1[0-5]|[0-9])(\.[0-9]+)?px)|(fontSize: ?['"'"'\"][0-9]{1,2}%)'

# Zero plików do skanu = strażnik melduje „passed" nad pustką i wychodzi zerem,
# czyli zamienia się w atrapę nie do odróżnienia od zieleni zapracowanej.
# Ta sama klasa cichej zieleni, którą ten audyt ma zamykać, tyle że piętro wyżej.
if [[ ! -d "$SRC_DIR" ]]; then
  print_error "Brak katalogu ${SRC_DIR#"${ROOT}/"} — nie ma czego skanować (zieleń nad zerem plików = atrapa)"
  exit 1
fi

# `|| true` jest tu OBOWIĄZKOWE: przy zerowym wyniku grep zwraca 1, a
# `set -euo pipefail` ubiłby skrypt PRZED komunikatem — czyli strażnik
# wychodziłby kodem 1 bez słowa wyjaśnienia, co jest tylko trochę lepsze
# od cichej zieleni.
SCANNED=$( { grep -rlE '' "$SRC_DIR" \
  --include="*.ts" --include="*.tsx" --include="*.css" \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=out --exclude-dir=dist \
  2>/dev/null || true; } | wc -l | tr -d ' ')
if [[ "$SCANNED" -eq 0 ]]; then
  print_error "Zero plików .ts/.tsx/.css w ${SRC_DIR#"${ROOT}/"} — strażnik raportowałby „passed” nad pustką"
  exit 1
fi

HITS=$(grep -rEn "$PATTERN" "$SRC_DIR" \
  --include="*.ts" --include="*.tsx" --include="*.css" \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=out --exclude-dir=dist \
  2>/dev/null || true)

# Odfiltruj grandfatherowane pliki (po ścieżce względnej do ROOT).
VIOLATIONS=0
FILTERED=""
if [[ -n "$HITS" ]]; then
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    rel="${line#"${ROOT}/"}"
    file="${rel%%:*}"
    skip=0
    for gf in "${GRANDFATHERED[@]}"; do
      [[ "$file" == "$gf" ]] && skip=1 && break
    done
    [[ "$skip" -eq 1 ]] && continue
    FILTERED+="${line}"$'\n'
    VIOLATIONS=$((VIOLATIONS + 1))
  done <<< "$HITS"
fi

# ── Gałąź clamp/min/max (S100b) ────────────────────────────────────────────
CLAMP_HITS=$(SRC_DIR="$SRC_DIR" ROOT="$ROOT" node - "${GRANDFATHERED[@]}" <<'NODE'
const fs = require("fs"), path = require("path");
const ROOT = process.env.ROOT.replace(/\/?$/, "/");
const grandfathered = new Set(process.argv.slice(2).map(p => ROOT + p));
const FLOOR = 16; // ta sama podloga co dla wartosci golej — patrz naglowek

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", ".next", "out", "dist"].includes(e.name)) continue;
      walk(p, out);
    } else if (/\.(css|tsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}

const out = [];
for (const file of walk(process.env.SRC_DIR)) {
  if (grandfathered.has(file)) continue;
  const rel = file.startsWith(ROOT) ? file.slice(ROOT.length) : file;
  const flat = fs.readFileSync(file, "utf8").replace(/\s+/g, " ");
  const re = /font-?[sS]ize:\s*[^;}]*?(?:clamp|min|max)\(([^;}]*?)\)/g;
  let m;
  while ((m = re.exec(flat))) {
    const decl = m[0];
    const lengths = [
      ...[...decl.matchAll(/([0-9.]+)px/g)].map(x => parseFloat(x[1])),
      ...[...decl.matchAll(/([0-9.]+)rem/g)].map(x => parseFloat(x[1]) * 16),
    ];
    if (!lengths.length) continue;
    const min = Math.min(...lengths);
    if (min < FLOOR) out.push(`${rel}  ${min}px w ${decl.trim().slice(0, 90)}`);
  }
}
process.stdout.write(out.join("\n"));
NODE
)

if [[ -n "$CLAMP_HITS" ]]; then
  CLAMP_COUNT=$(echo "$CLAMP_HITS" | grep -c '' || true)
  VIOLATIONS=$((VIOLATIONS + CLAMP_COUNT))
  FILTERED+="$CLAMP_HITS"$'\n'
fi

print_separator
if [[ "$VIOLATIONS" -gt 0 ]]; then
  print_error "Min font-size audit FAILED — ${VIOLATIONS} font(s) < 16px:"
  echo "$FILTERED" | sed 's/^/    /'
  echo ""
  print_info "Napraw: podnieś rozmiar do ≥ 16px (floor ownera) albo użyj tokenu --text-* (>= --text-base)."
  print_info "Zapis relatywny < 1 (0.85em / .9em / 0.875rem / 85%) jest zakazany BEZ WZGLĘDU na wynik:"
  print_info "  liczy się od rodzica, więc ten sam kod daje inny px w każdym kontekście. Użyj tokenu --text-*."
  print_info "Reguła: DESIGN.md → Typografia. Nowe strony /dev NIE są zwalniane z floora."
  exit 1
fi

print_success "Min font-size audit passed — brak czcionek < 16px ani zapisów relatywnych < 1 w main/src (poza grandfatherowanymi /dev)"
exit 0
