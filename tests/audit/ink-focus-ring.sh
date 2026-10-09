#!/usr/bin/env bash
# ink-focus-ring.sh — pierścień fokusu MUSI być przemapowany na każdej
# powierzchni atramentowej.
#
# LUKA, KTÓRĄ ZAMYKA (S98):
#   `--color-focus-ring` jest w trybie JASNYM celowo równy `--color-ink`
#   (DECISION S14: ink daje 17:1 na bieli, a złoto tylko 2,2:1, czyli poniżej
#   progu 3:1 z WCAG SC 1.4.11). Konsekwencji nikt nie policzył: na powierzchni
#   ATRAMENTOWEJ ten sam pierścień rysuje się ink-na-ink, czyli 1,00:1 —
#   nawigacja klawiaturą po prostu ginie. Dotyczyło to WSZYSTKICH 21 powierzchni
#   atramentowych produktu, w tym głównych przycisków zakupu na cenniku i na
#   stronie płatności, i przeżyło komplet zielonych bramek, bo żadna z nich nie
#   umiała tego zobaczyć: kontrast liczy się tu między dwoma tokenami, z których
#   jeden jest ustawiany lokalnie, a drugi globalnie.
#
# REGUŁA (strukturalna, bez baseline'ów — nic tu nie gnije):
#   Blok CSS pod `main/src/UI`, który ustawia `background: var(--color-ink)`
#   albo `background: var(--footer-bg)`, MUSI w tym samym bloku deklarować
#   `--color-focus-ring` — i NIE WOLNO mu przemapować go na `--color-primary`.
#
#   DRUGA POŁOWA REGUŁY (S109): sam remap nie wystarcza, bo liczy się WARTOŚĆ.
#   Do wymiany palety na rouge-papier poprawna była tu `var(--color-primary)`
#   (charcoal-gold miał primary w jasnym złocie). Po wymianie primary jest
#   CIEMNĄ czerwienią (L 0.565) i na atramencie daje 3,6:1, czyli zjada cały
#   zapas nad progiem 3:1 dla wskaźnika. Rolą akcentu na negatywie jest
#   `--color-accent-on-ink` (DECISION S106 w palettes.css) i strażnik pilnuje
#   teraz właśnie jej. Bez tego siedem powierzchni przeszło zielono z wartością,
#   którą ten sam plik POLECAŁ w swojej instrukcji naprawy.
#   WYJĄTEK: komentarz `focus-ring-allow: <powód>` w bloku albo w jego główce.
#   Powód jest OBOWIĄZKOWY — sam marker bez uzasadnienia nie zwalnia.
#
#   Bloki wewnątrz `[data-mode='dark']` są POZA regułą: w ciemnym trybie
#   pierścień jest złoty (`#e8c460`) i na atramencie trzyma 7,75:1, więc remap
#   byłby tam pogorszeniem, nie naprawą.
#
# EXIT: 0 gdy czysto, 1 przy pierwszym naruszeniu (z pełną listą).
set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
UI_DIR="${ROOT}/main/src/UI"

print_boxed_header "Focus-ring na pasach: atrament i złoto" "⌨️"

# FAIL-LOUD, jak rodzenstwo (tint-discipline, edge-stripe, min-font-size).
# Brak katalogu to nie jest „nie ma czego sprawdzac", tylko „skan nie ma na czym
# pracowac" — a bramka, ktora w takiej sytuacji melduje sukces, jest gorsza niz
# jej brak. Ten skrypt byl jedynym z czworki, ktory tu zwracal zero.
if [[ ! -d "$UI_DIR" ]]; then
  print_error "Brak katalogu $UI_DIR — skan nie mial na czym pracowac"
  exit 1
fi

declare -a CSS_FILES
mapfile -t CSS_FILES < <(find "$UI_DIR" -name "*.module.css" -type f \
  -not -path "*/dev/playground/*" | sort || true)

if [[ "${#CSS_FILES[@]}" -eq 0 ]]; then
  print_error "Zero arkuszy do skanowania — to nie jest zieleń, to zepsuty skan"
  exit 1
fi

print_header "Skanuję ${#CSS_FILES[@]} arkuszy pod kątem powierzchni atramentowych bez remapu"

# BEZ `|| true`: kazdy throw w skanerze (np. plik zniknniety w trakcie skanu)
# zamienialby sie w pusta zmienna i print_success, czyli w cicha zielen. Pod
# `set -euo pipefail` wywrotka skanera ma byc twardym bledem audytu, tak jak
# w siostrzanym tint-discipline.
VIOLATIONS=$(node -e '
const fs = require("fs");
const files = process.argv.slice(1);
const out = [];
// `--footer-bg` NIE ma prefiksu `--color-`, wiec alternatywa musi obejmowac
// cale nazwy tokenow, nie sam ogon (pierwsza wersja tego regexa gubila stopke).
// S110: dolozone role pasa krytycznego (L 0.50) i nakladki na zdjeciu — obie sa
// ciemnymi plaszczyznami, ktore hostuja kontrolki (przycisk zamkniecia paska,
// serce/pin/share na kafelku). Pas OSTRZEGAWCZY jest jasny (L 0.78), wiec bazowy
// atramentowy ring trzyma sie na nim sam i celowo NIE jest tu wymieniony.
// S109: role pasa fioletowego doszly do tej listy, bo ich WARTOSCI przeniosly
// sie z lokalnych aliasow (--ink-band / --ink-violet w modulach) do palety.
// Galaz "ciemny pas przez alias" rozwiazuje JEDEN skok w TYM SAMYM pliku, wiec
// po promocji do roli przestalaby te pasy widziec — straznik oslepilby sie
// wlasnym porzadkowaniem. Nazwa roli jest tu tansza i pewniejsza niz siegniecie
// do palettes.css: role sa mode-invariant i z definicji ciemne.
// DECISION (nie usuwaj tego komentarza):
// SLEPA PLAMA ZAMKNIETA — „plaszczyzna atramentowa" byla twarda lista SIEDMIU
// nazw tokenow, a atrament ma w tej palecie OSMA nazwe: `--color-text-primary`
// (light: oklch(0.215 0.012 75), praktycznie to samo co `--color-ink`
// oklch(0.205 0.015 40)). Ten token jest uzywany jako TLO w 5 miejscach pod
// main/src/UI, wiec obejscie reguly stalo otworem: wystarczylo napisac
// `background: var(--color-text-primary)` zamiast `var(--color-ink)`, zeby
// dowolny nowy pas atramentowy przeszedl bramke bez remapu pierscienia — i to
// zapis BARDZIEJ naturalny, bo tego tokena siega sie tu na co dzien po kolor
// tekstu. POMIAR: przed = 7 nazw / 21 blokow trafionych, po = 8 nazw /
// 26 blokow trafionych (5 nowych, wszystkie zbadane pojedynczo).
// UWAGA NA ROZNICE: pozostale role sa ciemne w OBU trybach, a
// `--color-text-primary` FLIPUJE (dark: oklch(0.945 0.006 75) = prawie papier).
// Ta bramka i tak liczy tylko polowe jasna (bloki `data-mode='dark'` sa poza
// regula), wiec dokladanie go tutaj jest poprawne dla tego, co bramka mierzy.
// Polowa ciemna — zloty pierscien na prawie-bieli — jest realna, ale osobna:
// wymagalaby remapu zaleznego od trybu, a nie pojedynczej wartosci, i zaden
// z 5 obecnych blokow nie jest hostem fokusu (patrz ich znaczniki
// `focus-ring-allow:`), wiec NIE dokladamy tu drugiej galezi na zapas.
const INK_BG = /background:\s*var\(\s*(--color-ink|--footer-bg|--color-ink-band|--color-ink-band-strong|--color-banner-critical|--color-photo-overlay|--color-photo-overlay-strong|--color-text-primary)\s*\)\s*;/;
// Zloty BAND to ta sama pulapka odwrocona: w DARK bazowy ring jest zloty, wiec
// na zlotym tle znika (zmierzone: 1,17:1 na /compare). Regula celuje wylacznie
// w PASY pelnej szerokosci (idiom `width: 100vw` + breakout), a nie w kazde
// zlote tlo — badge, kropka statusu czy sam przycisk nie hostuja fokusu w srodku.
const GOLD_BAND = /background:\s*var\(\s*--color-primary\s*\)\s*;/;
const FULL_BLEED = /width:\s*100vw\s*;/;
// Trzecia klasa: PAS o ciemnym tle podanym przez LOKALNY alias, a nie przez
// token palety — tak wygladal fioletowy pas newslettera (`--ink-band:
// oklch(0.46 0.1 288)`), ktory mial 2,29:1 na pierscieniu fokusu i byl dla
// tej reguly calkowicie niewidzialny. Rozwiazujemy JEDEN skok aliasu w tym
// samym pliku i pytamy o jasnosc: `oklch(L …)` ponizej 0.6 albo hex o niskiej
// luminancji to ciemna plaszczyzna, wiec ring musi byc przemapowany.
// [A-Za-z0-9_-]: nazwa aliasu bywa pisana camelCase (`--inkBand`), a waska
// klasa znakow przepuszczala wtedy CALA trzecia galaz bez sladu.
const ALIAS_BG = /background:\s*var\(\s*(--[A-Za-z0-9_-]+)\s*\)\s*;/;
const isDarkValue = (v) => {
  const ok = v.match(/oklch\(\s*([0-9.]+)%?/);
  if (ok) {
    const l = parseFloat(ok[1]);
    return (l > 1 ? l / 100 : l) < 0.6;
  }
  const hex = v.match(/#([0-9a-fA-F]{6})\b/);
  if (hex) {
    const c = [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16) / 255);
    const f = (x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) < 0.25;
  }
  return false;
};
const REMAP = /--color-focus-ring\s*:/;
// Remap NA --color-primary jest na atramencie tak samo zly jak jego brak:
// po wymianie palety to ciemna czerwien (3,6:1 na inku). Rola dla negatywu
// to --color-accent-on-ink. Osobna galaz, zeby komunikat mowil, CO podmienic.
const BAD_REMAP = /--color-focus-ring\s*:\s*var\(\s*--color-primary\s*\)/;
// Powod jest obowiazkowy. `\S` nie wystarcza: w zapisie `/* focus-ring-allow: */`
// pierwszym nie-bialym znakiem po dwukropku jest gwiazdka zamykajaca komentarz,
// wiec pusty marker udawal uzasadnienie.
const ALLOW = /focus-ring-allow:[ \t]*[^\s*\/][^\n]*/;
const DARK = /data-mode=.dark./;

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const lines = src.split("\n");
  let depth = 0, headStart = 0, blockStart = -1, head = "", body = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    if (opens && depth === 0) {
      head = lines.slice(Math.max(0, headStart), i + 1).join("\n");
      blockStart = i;
      body = [];
    }
    if (depth > 0 || (opens && depth === 0)) body.push(line);
    depth += opens - closes;
    if (depth === 0 && blockStart >= 0 && closes) {
      const text = body.join("\n");
      // Reguła omija bloki dark: tam ring jest złoty i trzyma kontrast.
      const inDark = DARK.test(head);
      // Nazwa galezi leci do komunikatu, zeby bylo wiadomo, KTORY przypadek
      // strzelil — inaczej fixtura nie ma czym dowiesc, ze pokrywa wlasna
      // regule, a nie cudza (obie konczylyby sie identycznym tekstem).
      let plane = INK_BG.test(text)
        ? "atrament"
        : (GOLD_BAND.test(text) && FULL_BLEED.test(text) ? "zloty pas" : null);
      // Sygnalem NIE jest tu `width: 100vw` — pelna szerokosc daje zwykle
      // kompozycja Section, a nie sam blok. Plaszczyzne zdradza to, ze blok
      // USTAWIA WLASNY `color`, czyli deklaruje tekst-na-swoim-tle. To odsiewa
      // drobne elementy dekoracyjne, ktore tylko malują tło.
      // Blok musi byc LISCIEM (jedna klamra otwierajaca): parser zbiera cale
      // ciało reguly, wiec opakowanie `@media (hover: hover) { .x:hover { … } }`
      // widzialo tlo i `color` swojego DZIECKA i zglaszalo stan hover jako
      // plaszczyzne. Cztery takie falszywki wypadly od razu po poszerzeniu.
      const isLeaf = (text.match(/\{/g) || []).length === 1;
      if (!plane && isLeaf && /(^|[;{\s])color:\s*[^;]+;/.test(text)) {
        const m2 = text.match(ALIAS_BG);
        if (m2) {
          const def = src.match(new RegExp(m2[1] + "\\s*:\\s*([^;]+);"));
          if (def && isDarkValue(def[1])) plane = "ciemny pas przez alias";
        }
      }
      const allowed = ALLOW.test(text) || ALLOW.test(head);
      if (!inDark && plane && !REMAP.test(text) && !allowed) {
        const sel = (head.trim().split("\n").pop() || "").replace(/\s*\{\s*$/, "");
        out.push(`${file}:${blockStart + 1}: [${plane}] ${sel.slice(0, 70)}`);
      }
      // Zla WARTOSC remapu dotyczy tylko plaszczyzn ciemnych: na "zlotym pasie"
      // oczekiwana wartoscia jest --color-ink, wiec ta galaz go nie dotyczy.
      if (!inDark && plane && plane !== "zloty pas" && BAD_REMAP.test(text) && !allowed) {
        const sel = (head.trim().split("\n").pop() || "").replace(/\s*\{\s*$/, "");
        out.push(`${file}:${blockStart + 1}: [${plane}: ring na --color-primary] ${sel.slice(0, 70)}`);
      }
      blockStart = -1;
      headStart = i + 1;
    }
    if (depth === 0 && !opens && !closes && line.trim() === "") headStart = i + 1;
  }
}
console.log(out.join("\n"));
' "${CSS_FILES[@]}")

print_separator
if [[ -n "$VIOLATIONS" ]]; then
  COUNT=$(echo "$VIOLATIONS" | grep -c . || true)
  print_error "Ink focus-ring FAILED — ${COUNT} powierzchni-pasow bez remapu pierscienia:"
  echo "$VIOLATIONS" | sed 's/^/    /'
  echo ""
  print_info "Napraw: dopisz w bloku remap pierscienia —"
  print_info "  [atrament]  --color-focus-ring: var(--color-accent-on-ink);  (akcent na negatywie)"
  print_info "  [zloty pas] --color-focus-ring: var(--color-ink);            (atrament na akcencie)"
  print_info "Dlaczego: w LIGHT --color-focus-ring == --color-ink, więc na tej"
  print_info "  powierzchni pierścień ma 1,00:1 i nawigacja klawiaturą ginie."
  print_info "Dlaczego NIE --color-primary: po wymianie palety na rouge-papier to"
  print_info "  ciemna czerwień (L 0.565) — na atramencie 3,6:1, bez zapasu nad"
  print_info "  progiem 3:1. Rolą dla negatywu jest --color-accent-on-ink (S106)."
  print_info "Świadomy wyjątek: komentarz  /* focus-ring-allow: <powód> */  w bloku."
  exit 1
fi

print_success "Focus-ring passed — kazdy pas, ktory ta regula WIDZI (atrament, role pasow, zloty pas pelnej szerokosci, ciemny alias w tym samym pliku), remapuje pierscien"
  print_info "Czego ta bramka NIE widzi (i nie udaje, ze widzi): tlo podane przez"
  print_info "  background-color, przez skrot z wieloma wartosciami, przez rodzica"
  print_info "  z innego pliku, przez inline style w TSX, oraz pas na --color-primary"
  print_info "  bez width:100vw (rozszerzenie regexa dawaloby falszywke na kazdym"
  print_info "  wypelnionym przycisku). Tam wskaznik trzeba sprawdzic okiem albo"
  print_info "  sonda scripts/qa-contrast-probe.cjs. Bitmapy nie zmierzy zadna z nich."
exit 0
