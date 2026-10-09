#!/usr/bin/env bash
# motion-tokens.sh — czasy ruchu ze skali + ochrona przed martwym `transition`.
#
# DWIE REGULY, obie parsowane blokowo (prettier zawija dlugie listy skrotu,
# wiec jednoliniowy grep pokazuje ulamek prawdy — lekcja S97):
#
#  1. ZLOZENIE + WLASNA KRZYWA = deklaracja martwa (BLAD, zero tolerancji).
#     `--transition-*` niesie JUZ krzywa (`200ms ease`), wiec
#     `transition: transform var(--transition-normal) var(--ease-entrance)`
#     rozwija sie do DWOCH funkcji czasu. CSS odrzuca taka deklaracje w
#     calosci — przejscie nie dziala wcale, a nic tego nie zglasza: nie ma
#     bledu w konsoli, typecheck milczy, screenshot statyczny wyglada dobrze.
#     Trzy takie siedzialy w repo do S100, w tym chevron FAQ, ktory z komentarza
#     obok mial „spring 200ms", a w rzeczywistosci przeskakiwal bez animacji.
#     Masz wlasna krzywa? Bierz goly `--duration-N`.
#
#  2. SUROWY CZAS w `transition` = ratchet (blokuje przyrost).
#     Do S100 bylo 305 surowych czasow przy 42 roznych wartosciach, z czego 263
#     w pasmie 150-240ms — na tych samych wlasciwosciach (transform, background,
#     border-color, color). To nie byly decyzje projektowe, tylko brak nazwy,
#     po ktora dalo sie siegnac: ten sam hover miewal 160ms na jednej stronie i
#     240ms na drugiej. Roznica niewidoczna w kodzie, w skladzie tez zadna —
#     ale produkt nie mial JEDNEJ predkosci odpowiedzi.
#     Poza pasmem zostaja czasy, ktore sa choreografia (paski postepu, rozwijanie
#     tresci, `stroke-dashoffset`) — te maja prawo byc wlasne.
#
# EXIT: 1 gdy regula 1 ma trafienie ALBO gdy licznik reguly 2 urosl.
set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SRC_DIR="${ROOT}/main/src"
BASELINE="${MOTION_TOKENS_BASELINE:-26}"

print_boxed_header "Motion tokens: czasy ze skali, zero martwych transition" "⏱"

if [[ ! -d "$SRC_DIR" ]]; then
  print_error "Brak ${SRC_DIR#"${ROOT}/"} — zielen nad pustka to nie zielen"
  exit 1
fi

REPORT=$(SRC_DIR="$SRC_DIR" ROOT="$ROOT" node <<'NODE'
const fs = require("fs"), path = require("path");
const ROOT = process.env.ROOT.replace(/\/?$/, "/");

function walk(d, o = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (["node_modules", ".next", "out", "dist"].includes(e.name)) continue;
      walk(p, o);
    } else if (e.name.endsWith(".css")) o.push(p);
  }
  return o;
}
// podzial listy skrotu po przecinkach NAJWYZSZEGO poziomu — cubic-bezier ma swoje w srodku
function splitTop(s) {
  const out = []; let d = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") d++; else if (ch === ")") d--;
    if (ch === "," && d === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur); return out;
}

const dead = [], raw = [];
for (const f of walk(process.env.SRC_DIR)) {
  if (f.endsWith("styles/tokens.css")) continue;
  const rel = f.startsWith(ROOT) ? f.slice(ROOT.length) : f;
  const flat = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");
  for (const m of flat.matchAll(/\btransition\s*:\s*([^;}]*)/g)) {
    for (const part of splitTop(m[1])) {
      const composite = /var\(--transition-(fast|normal|slow)\)/.test(part);
      const ownCurve = /cubic-bezier|steps\(|var\(--(?:ease|spring)[a-z-]*\)|(?<![\w-])(?:linear|ease-in-out|ease-out|ease-in)(?![\w-])/.test(part);
      if (composite && ownCurve) dead.push(`${rel}  ${part.trim().slice(0, 90)}`);
      const t = part.match(/(?<![\w-])([0-9.]+)(ms|s)(?![\w-])/);
      if (t) raw.push(`${rel}  ${part.trim().slice(0, 90)}`);
    }
  }
}
console.log(JSON.stringify({ dead, rawCount: raw.length, raw: raw.slice(0, 25) }));
NODE
)

DEAD_COUNT=$(echo "$REPORT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).dead.length))')
RAW_COUNT=$(echo "$REPORT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).rawCount))')

print_header "Martwe deklaracje: ${DEAD_COUNT} | surowe czasy w transition: ${RAW_COUNT} (baseline ${BASELINE})"
print_separator

if [[ "$DEAD_COUNT" -gt 0 ]]; then
  print_error "Zlozenie --transition-* z wlasna krzywa = DWIE funkcje czasu, deklaracja odrzucana przez CSS:"
  echo "$REPORT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>JSON.parse(s).dead.forEach(l=>console.log("    "+l)))'
  print_info "Napraw: wlasna krzywa -> goly var(--duration-N); bez krzywej -> var(--transition-*)."
  exit 1
fi

if [[ "$RAW_COUNT" -gt "$BASELINE" ]]; then
  print_error "Motion-tokens FAILED — ${RAW_COUNT} surowych czasow w transition, baseline ${BASELINE}:"
  echo "$REPORT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>JSON.parse(s).raw.forEach(l=>console.log("    "+l)))'
  print_info "Napraw: czas z var(--duration-N) albo zlozenie var(--transition-*). Skala: tokens.css."
  exit 1
fi

if [[ "$RAW_COUNT" -lt "$BASELINE" ]]; then
  print_warning "Motion-tokens: ${RAW_COUNT} < baseline ${BASELINE} — ZACISNIJ baseline w tym pliku"
fi

print_success "Motion-tokens passed — zero martwych transition, surowe czasy nie rosna"
exit 0
