#!/usr/bin/env bash
# audit-selftest.sh — META-STRAŻNIK: czy strażnicy w ogóle łapią własne naruszenia.
#
# INTENT:
#   W tests/audit/ stoi blisko sto skryptów i przez cały czas ich istnienia
#   ŻADEN nie miał dowodu, że wywraca się na naruszeniu, którego pilnuje.
#   Zieleń znaczyła więc dokładnie tyle, ile warty był regex napisany raz,
#   bez testu. Ta luka zmaterializowała się w tym repo DWA RAZY:
#
#     - ratchet gwiazdek (S91) dopasowywał współrzędne JEDNEJ ścieżki SVG,
#       więc ta sama czteroramienna satyna zapisana innymi liczbami
#       przechodziła obok niego bez śladu;
#     - ratchet tintów (S97) wymagał zapisu `color-mix(in oklch,
#       var(--color-primary) N%` — złoto na PIERWSZEJ pozycji i tylko w oklch —
#       więc raportował zielono nad 34 żywymi tintami, a fala „domknięta na
#       zero" zostawiła jedną trzecią roboty.
#
#   Strażnik na złym wzorcu jest GORSZY niż brak strażnika: brak wiadomo, że
#   niczego nie pilnuje, a zielony daje fałszywą pewność i wygasza czujność.
#
# JAK TO DZIAŁA:
#   Dla każdego katalogu tests/audit/_fixtures/<audyt>/ budujemy tymczasowy
#   „mini-projekt", wrzucamy do niego POJEDYNCZĄ próbkę i puszczamy na nim
#   prawdziwy skrypt audytu przez AUDIT_ROOT_OVERRIDE (jedyne zastosowanie tej
#   zmiennej — patrz get_project_root w _utils.sh).
#     must-fail/<x> → audyt MUSI zwrócić kod ≠ 0
#     must-pass/<x> → audyt MUSI zwrócić 0
#   Próbka na próbkę, nie hurtem: inaczej jeden łapany przypadek maskuje
#   dziesięć przepuszczonych, czyli powtarzamy dokładnie ten błąd, który
#   ten plik ma wykluczyć.
#
#   SAM KOD WYJŚCIA TO ZA MAŁO. Kod ≠ 0 znaczy „audyt się wywrócił", a nie
#   „audyt złapał TO, co próbka deklaruje". Dwa realne skutki tej luki:
#     - próbka łamiąca DWIE rzeczy naraz zalicza się jako pokrycie reguły,
#       której skaner wcale nie sprawdza (tak żyła próbka pustego escape'u:
#       po wyłączeniu gałęzi „marker bez powodu" nadal failowała, na tincie);
#     - `set -euo pipefail` w skanerze sprawia, że wywrotka node'a (błąd
#       składni, brak binarki) też daje kod 1 — czyli „wszystkie must-fail
#       złapane" przy CAŁKOWICIE martwym skanerze.
#   Dlatego obok próbki może stać plik `<nazwa>.expect`: każda jego linia to
#   fragment, który MUSI paść w wyjściu audytu. Brak `.expect` jest dozwolony,
#   ale raportowany na końcu jako SŁABSZE POKRYCIE — cicho nie przechodzi.
#
#   LUSTRZANA luka po stronie MUST-PASS: `.expect` sprawdzało wyłącznie próbki
#   must-fail, więc próbka, która przechodzi z NIEWŁAŚCIWEGO powodu, była
#   niewykrywalna — a to najdroższy błąd tego mechanizmu, bo taka próbka
#   DEKLARUJE pokrycie gałęzi, której skaner wcale nie dotyka. Realny przypadek
#   z tego repo: fixture twierdzący, że opakowanie `@media` nie jest
#   płaszczyzną, przechodził dlatego, że jego alias miał camelCase i cała
#   gałąź go nie widziała. Dlatego obok próbki MUST-PASS może stać
#   `<nazwa>.expect-not`: lista fragmentów, które NIE MOGĄ paść w wyjściu
#   audytu. Sprawdzana jest NIEZALEŻNIE od kodu wyjścia, więc łapie też audyt,
#   który melduje naruszenie, a mimo to wychodzi zerem (findings wypisane
#   w bloku ostrzeżenia, kod zjedzony przez potok). Brak pliku = jak dotąd.
#
# DOPISANIE FIXTURA:
#   tests/audit/_fixtures/<nazwa-audytu>/
#     _target.txt          — katalog docelowy w mini-projekcie (jedna linia),
#                            np. main/src/UI/features/fixture
#     must-fail/*.css|tsx  — próbki, na których audyt MUSI się wywrócić
#     must-pass/*.css|tsx  — próbki, których NIE wolno mu tknąć
#     must-fail/<x>.expect — fragmenty komunikatu, po jednym w linii; każdy MUSI
#                            paść w wyjściu audytu (dotyczy tylko must-fail)
#     must-pass/<x>.expect-not — fragmenty, które NIE MOGĄ paść w wyjściu
#                            audytu (dotyczy tylko must-pass). Opcjonalny, ale
#                            dopisz go wszędzie tam, gdzie powód przechodzenia
#                            próbki jest NIEOCZYWISTY: wpisz komunikat reguły,
#                            której próbka ma NIE łamać, żeby „zieleń” nie
#                            mogła pochodzić z innej gałęzi niż deklarowana.
#                            Pusty plik = FAIL (deklaracja pokrycia bez pokrycia).
#   Nazwa próbki z „%" = ścieżka względem KORZENIA mini-projektu (%→/), gdy
#   przypadek zależy od lokalizacji pliku (np. reguła osobna dla
#   components/** niż dla features/**).
#   Próbka może być KATALOGIEM — wtedy do mini-projektu trafiają wszystkie
#   pliki z jego wnętrza (ta sama reguła „%"). Tak opisuje się przypadek,
#   którego jeden plik nie udźwignie: alias zdefiniowany w palecie i użyty
#   w module.
#
# EXIT: 0 gdy każda próbka zachowała się zgodnie z etykietą, 1 przy pierwszym
#   rozjeździe (z wypisem WSZYSTKICH rozjazdów).

set -uo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
AUDIT_DIR="${ROOT}/tests/audit"
FIXTURES="${AUDIT_DIR}/_fixtures"

print_boxed_header "Meta-strażnik: czy audyty łapią własne naruszenia" "🧪"

if [[ ! -d "$FIXTURES" ]]; then
  print_success "Brak _fixtures — nie ma czego sprawdzać"
  exit 0
fi

TMP_BASE="$(mktemp -d)"
trap 'rm -rf "$TMP_BASE"' EXIT

FAILURES=()
WEAK=()
CHECKED=0

run_sample() {
  local audit_sh="$1" target_dir="$2" sample="$3" expect="$4"
  local base rel tmp
  base="$(basename "$sample")"

  tmp="$(mktemp -d "${TMP_BASE}/case.XXXXXX")"

  if [[ -d "$sample" ]]; then
    # Próbka WIELOPLIKOWA: przypadek, którego jeden plik nie opisze (alias
    # w palecie + jego użycie w module). Każdy plik trafia w mini-projekt
    # wg tej samej reguły „%".
    local part pbase prel
    while IFS= read -r part; do
      [[ -n "$part" ]] || continue
      pbase="$(basename "$part")"
      if [[ "$pbase" == *%* ]]; then prel="${pbase//%//}"; else prel="${target_dir}/${pbase}"; fi
      mkdir -p "${tmp}/$(dirname "$prel")"
      cp "$part" "${tmp}/${prel}"
    done < <(find "$sample" -maxdepth 1 -type f | sort)
  else
    # „%" w nazwie = ścieżka względem korzenia mini-projektu (przypadki zależne
    # od lokalizacji pliku, np. prymityw współdzielony vs moduł strony).
    if [[ "$base" == *%* ]]; then rel="${base//%//}"; else rel="${target_dir}/${base}"; fi
    mkdir -p "${tmp}/$(dirname "$rel")"
    cp "$sample" "${tmp}/${rel}"
  fi

  local out status
  out="$(AUDIT_ROOT_OVERRIDE="$tmp" bash "$audit_sh" 2>&1)"
  status=$?
  CHECKED=$((CHECKED + 1))

  if [[ "$expect" == "fail" ]]; then
    if [[ "$status" -eq 0 ]]; then
      FAILURES+=("$(basename "$audit_sh") ← must-fail/${base}: audyt PRZESZEDŁ, choć próbka łamie regułę")
      return
    fi
    # Kod wyjścia mówi tylko „wywrócił się". Dowodem POKRYCIA jest komunikat.
    local expect_file="${sample%/}.expect" frag
    if [[ -f "$expect_file" ]]; then
      # `|| [[ -n "$frag" ]]` — plik BEZ końcowego znaku nowej linii. Bez tego
      # `read` zwraca kod ≠ 0 na ostatniej linii, ciało pętli jej nie widzi,
      # a jednolinijkowy `.expect` bez newline'a sprawdza ZERO fragmentów
      # i kupuje pełne pokrycie za darmo. Ta sama klasa cichej zieleni, którą
      # ten plik ma zamykać, tyle że piętro wyżej (znalezione przeglądem S98).
      local checked_frags=0
      while IFS= read -r frag || [[ -n "$frag" ]]; do
        [[ -n "${frag//[[:space:]]/}" ]] || continue
        checked_frags=$((checked_frags + 1))
        if ! grep -qF -- "$frag" <<<"$out"; then
          FAILURES+=("$(basename "$audit_sh") ← must-fail/${base}: wywrócił się z INNEGO powodu niż deklarowany")
          FAILURES+=("    brak w wyjściu: „${frag}”")
        fi
      done < "$expect_file"
      # Pusty (albo samo-białoznakowy) `.expect` to deklaracja pokrycia bez
      # pokrycia: `touch x.expect` uciszałby ostrzeżenie WEAK i nie sprawdzał nic.
      if [[ "$checked_frags" -eq 0 ]]; then
        FAILURES+=("$(basename "$audit_sh") ← must-fail/${base}: plik .expect jest PUSTY — deklaruje pokrycie, którego nie sprawdza")
      fi
    else
      WEAK+=("$(basename "$audit_sh") ← must-fail/${base}")
    fi
  elif [[ "$expect" == "pass" ]]; then
    if [[ "$status" -ne 0 ]]; then
      FAILURES+=("$(basename "$audit_sh") ← must-pass/${base}: audyt WYWRÓCIŁ SIĘ na legalnym zapisie")
      local detail
      detail="$(echo "$out" | grep -E '^[^ ].*:[0-9]+' | head -3 | tr '\n' '|')"
      [[ -n "$detail" ]] && FAILURES+=("    $detail")
    fi
    # Zieleń bez dowodu nic nie znaczy także po tej stronie: próbka, która
    # przechodzi z NIEWŁAŚCIWEGO powodu, deklaruje pokrycie gałęzi, której
    # skaner nie dotyka. `.expect-not` przypina powód przechodzenia do
    # KOMUNIKATU reguły — sprawdzany niezależnie od kodu wyjścia, bo audyt
    # potrafi wypisać naruszenie i mimo to wyjść zerem.
    local expect_not="${sample%/}.expect-not" nfrag
    if [[ -f "$expect_not" ]]; then
      local checked_nfrags=0
      while IFS= read -r nfrag || [[ -n "$nfrag" ]]; do
        [[ -n "${nfrag//[[:space:]]/}" ]] || continue
        checked_nfrags=$((checked_nfrags + 1))
        if grep -qF -- "$nfrag" <<<"$out"; then
          FAILURES+=("$(basename "$audit_sh") ← must-pass/${base}: audyt ZGŁOSIŁ regułę, której próbka nie łamie")
          FAILURES+=("    padło w wyjściu: „${nfrag}”")
        fi
      done < "$expect_not"
      if [[ "$checked_nfrags" -eq 0 ]]; then
        FAILURES+=("$(basename "$audit_sh") ← must-pass/${base}: plik .expect-not jest PUSTY — deklaruje pokrycie, którego nie sprawdza")
      fi
    fi
  fi
}

for dir in "$FIXTURES"/*/; do
  [[ -d "$dir" ]] || continue
  audit_name="$(basename "$dir")"
  audit_sh="${AUDIT_DIR}/${audit_name}.sh"

  if [[ ! -f "$audit_sh" ]]; then
    FAILURES+=("_fixtures/${audit_name}/ nie ma odpowiadającego ${audit_name}.sh")
    continue
  fi

  target_dir="$(head -1 "${dir}_target.txt" 2>/dev/null || true)"
  if [[ -z "$target_dir" ]]; then
    FAILURES+=("_fixtures/${audit_name}/_target.txt jest pusty lub go nie ma")
    continue
  fi

  n_fail=$(find "${dir}must-fail" -mindepth 1 -maxdepth 1 ! -name '*.expect' ! -name '*.expect-not' 2>/dev/null | wc -l | tr -d ' ')
  n_pass=$(find "${dir}must-pass" -mindepth 1 -maxdepth 1 ! -name '*.expect' ! -name '*.expect-not' 2>/dev/null | wc -l | tr -d ' ')
  print_header "${audit_name}: ${n_fail} próbek MUST-FAIL, ${n_pass} MUST-PASS"

  if [[ "$n_fail" -eq 0 ]]; then
    FAILURES+=("_fixtures/${audit_name}/must-fail/ jest puste — fixture bez próbki łamiącej regułę niczego nie dowodzi")
  fi

  while IFS= read -r sample; do
    [[ -n "$sample" ]] && run_sample "$audit_sh" "$target_dir" "$sample" fail
  done < <(find "${dir}must-fail" -mindepth 1 -maxdepth 1 ! -name '*.expect' ! -name '*.expect-not' 2>/dev/null | sort)

  while IFS= read -r sample; do
    [[ -n "$sample" ]] && run_sample "$audit_sh" "$target_dir" "$sample" pass
  done < <(find "${dir}must-pass" -mindepth 1 -maxdepth 1 ! -name '*.expect' ! -name '*.expect-not' 2>/dev/null | sort)
done

# ─── Audyty BEZ ANI JEDNEJ próbki ───────────────────────────────────────────
# Pętla wyżej iteruje po _fixtures/*/, więc audyt bez katalogu próbek jest dla
# tego meldunku NIEWIDZIALNY — a komunikat „PASSED — N próbek" nad blisko setką
# skryptów czyta się jak pokrycie całego katalogu. To dokładnie ta klasa cichej
# zieleni, którą ten plik ma zamykać, tylko piętro wyżej: nie „strażnik na złym
# wzorcu", ale „strażnik, o którym meta-strażnik nawet nie wie".
# Świadomie WEAK, nie FAIL: dopisanie fixtur do stu audytów naraz to osobna
# robota, a twardy fail zablokowałby każdy commit do czasu jej skończenia.
declare -a NO_FIXTURE=()
COVERED=0
while IFS= read -r audit_path; do
  name="$(basename "$audit_path" .sh)"
  case "$name" in
    _utils | run-all | audit-selftest) continue ;;
  esac
  if [[ -d "${FIXTURES}/${name}" ]]; then
    COVERED=$((COVERED + 1))
  else
    NO_FIXTURE+=("$name")
  fi
done < <(find "$AUDIT_DIR" -maxdepth 1 -name '*.sh' -type f | sort)

print_separator

if [[ "${#NO_FIXTURE[@]}" -gt 0 ]]; then
  TOTAL_AUDITS=$((COVERED + ${#NO_FIXTURE[@]}))
  print_warning "Słabsze pokrycie — ${#NO_FIXTURE[@]} z ${TOTAL_AUDITS} audytów NIE MA ani jednej próbki:"
  printf '  %s\n' "${NO_FIXTURE[@]}" | paste - - - 2>/dev/null | sed 's/\t/  /g' || printf '  %s\n' "${NO_FIXTURE[@]}"
  echo ""
  echo "  Te skrypty NIGDY nie udowodniły, że wywracają się na naruszeniu,"
  echo "  którego pilnują. Ich zieleń znaczy tyle, ile wart jest regex napisany"
  echo "  raz, bez testu. Załóż tests/audit/_fixtures/<nazwa>/ z _target.txt,"
  echo "  must-fail/ i must-pass/ — zaczynając od tych, które strzegą pieniędzy,"
  echo "  bezpieczeństwa i kontraktu API."
  echo ""
fi

if [[ "${#WEAK[@]}" -gt 0 ]]; then
  print_warning "Słabsze pokrycie — ${#WEAK[@]} próbek MUST-FAIL bez pliku .expect:"
  for w in "${WEAK[@]}"; do
    echo "  $w"
  done
  echo ""
  echo "  Kod wyjścia ≠ 0 dowodzi tylko, że audyt się wywrócił. Dopisz obok"
  echo "  próbki plik <nazwa>.expect z fragmentem komunikatu, żeby dowieść,"
  echo "  że trafia we WŁASNĄ regułę, a nie w cudzą (albo w martwy skaner)."
  echo ""
fi

if [[ "${#FAILURES[@]}" -gt 0 ]]; then
  print_error "Meta-strażnik FAILED — ${#FAILURES[@]} rozjazdów na ${CHECKED} próbkach:"
  echo ""
  for f in "${FAILURES[@]}"; do
    echo "  $f"
  done
  echo ""
  echo "Co to znaczy:"
  echo "  must-fail przeszedł  → strażnik NIE widzi zapisu, którego pilnuje."
  echo "                         Napraw SKANER, nie próbkę."
  echo "  must-pass wywrócił   → strażnik krzyczy na legalny zapis."
  echo "                         Zawęź regułę albo dodaj escape."
  echo "  inny powód niż .expect → próbka wywraca się na CUDZEJ regule, więc"
  echo "                         swojej nie pokrywa. Napraw PRÓBKĘ (zostaw w niej"
  echo "                         jedno naruszenie) albo skaner, jeśli to on zgubił"
  echo "                         własny komunikat."
  echo ""
  exit 1
fi

print_success "Meta-strażnik PASSED — ${CHECKED} próbek, każda zachowała się zgodnie z etykietą (pokryte audyty: ${COVERED}/$((COVERED + ${#NO_FIXTURE[@]})))"
exit 0
