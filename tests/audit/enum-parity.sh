#!/usr/bin/env bash
# enum-parity.sh — Generic guard: every Prisma enum's value-set stays in sync
# with its kernel representation(s).
#
# INTENT:
#   A Prisma `enum` is the DB constraint — the exact set of strings a column can
#   physically store. The kernel re-states those same strings as TypeScript so
#   that all app code, validators and UI speak in typed values. The two live in
#   SEPARATE files and TSC does NOT relate them: a `'SHORT' | 'MEDIUM'` literal
#   union and a Prisma enum are, to the compiler, two unrelated types. So a value
#   added to the schema enum but forgotten in the kernel (or vice-versa) compiles
#   clean and only explodes at runtime — exactly the kind of silent drift that
#   bites hardest when this stack is forked into a new product and the domain
#   enums are rewritten. This audit is the missing compiler check.
#
#   pricing-parity.sh already guards PricingPlan (its own split SSOT). This audit
#   generalises that idea to EVERY other enum, on two levels:
#
#   LEVEL A — SCHEMA <-> GENERATED KERNEL MIRROR (all enums, auto-discovered):
#     The DTO generator emits `<Enum>Value = Object.freeze({...} as const)` into
#     .shared-kernel/models/db_models.generated.dto.ts for every enum. That file
#     is committed, so it can go stale if someone edits schema.prisma without
#     re-running the generator. We assert the schema enum value-set == the
#     generated <Enum>Value value-set. (PricingPlan is SKIP_ENUMS'd by the
#     generator and owned by pricing-parity.sh — exempt here.)
#
#   LEVEL B — SCHEMA <-> HAND-MAINTAINED KERNEL DUBEL (AUTO-DISCOVERED):
#     A few enums are ALSO duplicated by a hand-written value-list in a domain
#     config, independent of the generated mirror. THESE are the real silent
#     drift risk — nobody regenerates them, they are typed by hand. Derived
#     lists (e.g. ACCOUNT_ROLES = [AccountTypeValue.STYLIST, ...]) are NOT a
#     risk — they reference the kernel const, so TSC already catches their
#     drift, and discovery skips them for exactly that reason.
#
# DECISION (nie usuwaj tego komentarza):
#   SLEPA PLAMA ZAMKNIETA — Level B byl RECZNA, dwuelementowa lista (`DUBELS`:
#   NailLength/NAIL_LENGTHS, StaffRole/STAFF_ROLES) i przegapial realny trzeci
#   dubel: `TIMELINE_EVENT_TYPES` w `.shared-kernel/domain/admin/admin.config.ts`
#   przepisuje RECZNIE wszystkie 6 wartosci `enum EventLogType`, bez ani jednej
#   referencji do `EventLogTypeValue`. To NIE jest ozdoba: lista karmi allowliste
#   walidacji (`.shared-kernel/policies/validation/admin-logs.validation.ts` —
#   `includes(...)` w linii 180 i `z.enum(...)` w linii 196), wiec siodma wartosc
#   enuma przeszlaby KAZDA bramke (tsc, ESLint, vitest, ten audyt), a potem
#   zostalaby po cichu ODRZUCONA przez timeline admina jako „nieznany typ".
#   Bramka, ktora sama trzyma liste tego, czego pilnuje, jest kompletna dokladnie
#   do momentu, w ktorym ktos zapomni ja dopisac — czyli nigdy.
#   DLATEGO: lista znika, jej miejsce zajmuje ODKRYWANIE. Kandydatem na dubel
#   jest kazdy const w .shared-kernel/**/*.ts (poza generowanym DTO) z >= 2
#   literalami 'WIELKIE_LITERY', ktorego przeciecie z jakims enumem schematu ma
#   >= 2 elementy i pokrywa >= 50% enuma. Heurystyka jest dwustronna, wiec lapie
#   i brak wartosci, i wartosc nadmiarowa.
#   POMIAR: przed = 2 dubel-e sprawdzane (recznie). Po = 4 kandydatow
#   wykrytych, 0 falszywych trafien; 1 pominiety jako EXEMPT (PricingPlanValue,
#   wlasciciel: pricing-parity.sh), zostaja 3 sprawdzane — o 50% wiecej niz lista,
#   w tym ten jeden, ktory naprawde mogl zabolec.
#   MUST_DISCOVER ponizej to asercja istnienia, nie lista zakresu: jesli
#   przeniesienie pliku albo zmiana ksztaltu wylaczy dubel z odkrywania,
#   straznik zapali sie na czerwono zamiast po cichu stracic zasieg.
#
# WHAT IT CHECKS (hard fail):
#   1. (Level A) For each schema enum != PricingPlan: value-set == <Enum>Value in
#      the generated DTO. Missing <Enum>Value is a failure (new enum not wired /
#      stale generated file).
#   2. (Level B) Every auto-discovered hand-maintained mirror == its schema enum.
#   3. (Level B) Every MUST_DISCOVER anchor is actually found by discovery.
#
# EXIT: 0 if PASS, 1 if any drift found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SCHEMA="${ROOT}/web-1/src/prisma/schema.prisma"
GEN="${ROOT}/.shared-kernel/models/db_models.generated.dto.ts"

# Enums owned by a dedicated audit — skipped by Level A's generic mirror.
EXEMPT_ENUMS=("PricingPlan")

# Existence anchors: mirrors that discovery MUST keep finding. Not a scope list —
# discovery finds mirrors on its own; this only makes a silent loss of coverage
# (file moved, const renamed, shape changed) fail loudly. Format: "CONST_NAME|EnumName".
MUST_DISCOVER=(
  "NAIL_LENGTHS|NailLength"
  "STAFF_ROLES|StaffRole"
  "TIMELINE_EVENT_TYPES|EventLogType"
)

print_boxed_header "Enum parity: schema.prisma <-> kernel value-sets" "🧩"

VIOLATIONS=0

is_exempt() {
  local needle="$1" e
  for e in "${EXEMPT_ENUMS[@]}"; do
    [[ "$e" == "$needle" ]] && return 0
  done
  return 1
}

# ─── Extract a Prisma enum's member names (the DB-allowed value-set) ──────────
# Strips inline/standalone `// ...` comments so a DECISION note between members
# (e.g. enum PaymentStatus) does not pollute the set.
extract_schema_enum() {
  local name="$1"
  awk -v name="$name" '
    $0 ~ "^enum " name "[[:space:]]*\\{" { f=1; next }
    f && /^\}/ { f=0 }
    f {
      line=$0
      sub(/\/\/.*/, "", line)
      gsub(/[[:space:]]/, "", line)
      if (line != "") print line
    }' "$SCHEMA" | sort
}

# ─── Extract the RHS string literals of a `Object.freeze({...} as const)` const ─
# Works for both the generated <Enum>Value consts and the NAIL_LENGTHS-style dubel
# (keys are unquoted, values are 'QUOTED', so only values match the literal regex).
extract_freeze_values() {
  local file="$1" const="$2"
  awk -v const="$const" '
    $0 ~ ("(^|[^A-Za-z0-9_])" const "[[:space:]]*=[[:space:]]*Object\\.freeze") { f=1; next }
    f && /\}[[:space:]]*as const/ { f=0 }
    f { if (match($0, /'\''[A-Z_]+'\''/)) print substr($0, RSTART+1, RLENGTH-2) }
  ' "$file" | sort
}

# ─── Extract string literals from an `[...] as const` array const (STAFF_ROLES) ─
extract_array_values() {
  local file="$1" const="$2"
  awk -v const="$const" '
    $0 ~ ("(^|[^A-Za-z0-9_])" const "[[:space:]]*=") { f=1 }
    f { buf = buf $0 "\n" }
    f && /as const/ { print buf; exit }
  ' "$file" | grep -oE "'[A-Z_]+'" | tr -d "'" | sort
}

# ─── Generic dubel extractor: pick shape by what the file actually contains ────
extract_dubel_values() {
  local file="$1" const="$2"
  if grep -qE "(^|[^A-Za-z0-9_])${const}[[:space:]]*=[[:space:]]*Object\\.freeze" "$file"; then
    extract_freeze_values "$file" "$const"
  else
    extract_array_values "$file" "$const"
  fi
}

report_drift() {
  local label_schema="$1" label_other="$2" schema_vals="$3" other_vals="$4"
  local only_schema only_other
  only_schema=$(comm -23 <(echo "$schema_vals") <(echo "$other_vals") | tr '\n' ' ')
  only_other=$(comm -13 <(echo "$schema_vals") <(echo "$other_vals") | tr '\n' ' ')
  [[ -n "${only_schema// }" ]] && print_info "  Only in ${label_schema}: ${only_schema}"
  [[ -n "${only_other// }"  ]] && print_info "  Only in ${label_other}: ${only_other}"
  return 0
}

# ═══ LEVEL A: schema enum <-> generated kernel mirror ════════════════════════
print_header "Level A: schema enums <-> generated <Enum>Value (db_models.generated.dto.ts)"

ENUM_NAMES=$(grep -oE '^enum [A-Za-z0-9_]+' "$SCHEMA" | awk '{print $2}')
A_OK=0
while read -r ENUM; do
  [[ -z "$ENUM" ]] && continue
  if is_exempt "$ENUM"; then
    print_info "skip ${ENUM} (owned by a dedicated audit)"
    continue
  fi

  SCHEMA_VALS=$(extract_schema_enum "$ENUM")
  GEN_VALS=$(extract_freeze_values "$GEN" "${ENUM}Value")

  if [[ -z "$SCHEMA_VALS" ]]; then
    VIOLATIONS=$((VIOLATIONS + 1))
    print_error "${ENUM}: could not extract values from schema.prisma"
  elif [[ -z "$GEN_VALS" ]]; then
    VIOLATIONS=$((VIOLATIONS + 1))
    print_error "${ENUM}: no ${ENUM}Value in generated DTO — new enum not wired, or stale generated file (run: npm run system:generate-dto)"
  elif [[ "$SCHEMA_VALS" != "$GEN_VALS" ]]; then
    VIOLATIONS=$((VIOLATIONS + 1))
    print_error "${ENUM} DRIFT — schema enum != generated ${ENUM}Value"
    report_drift "schema enum" "${ENUM}Value" "$SCHEMA_VALS" "$GEN_VALS"
    print_info  "  Fix: re-run npm run system:generate-dto (generated DTO is stale)."
  else
    A_OK=$((A_OK + 1))
  fi
done <<< "$ENUM_NAMES"
[[ "$A_OK" -gt 0 ]] && print_success "Generated mirror holds for ${A_OK} enum(s)"

# ═══ LEVEL B: schema enum <-> hand-maintained kernel dubel (AUTO-DISCOVERED) ══
print_header "Level B: schema enums <-> hand-maintained kernel dubels (auto-discovered)"

# Discovery emits one line per candidate: "EnumName|relative/file.ts|CONST_NAME".
# A candidate is a const holding >= 2 'UPPER_CASE' literals whose intersection
# with some schema enum has >= 2 members AND covers >= 50% of that enum.
# Skipped: the generated DTO (Level A owns it) and any const whose body cites
# `<Enum>Value` (derived from the kernel const — TSC already guards it).
DISCOVERED=$(ROOT="$ROOT" SCHEMA="$SCHEMA" node - <<'NODE'
const fs = require("fs"), path = require("path");
const ROOT = process.env.ROOT.replace(/\/?$/, "/");
const schema = fs.readFileSync(process.env.SCHEMA, "utf8");

const enums = {};
for (const m of schema.matchAll(/^enum ([A-Za-z0-9_]+)\s*\{([\s\S]*?)^\}/gm)) {
  enums[m[1]] = new Set(
    m[2].split("\n").map(l => l.replace(/\/\/.*/, "").trim()).filter(Boolean)
  );
}

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules|\.next|\/out\/|\/dist\//.test(p)) walk(p); }
    else if (e.name.endsWith(".ts") && !e.name.endsWith("db_models.generated.dto.ts")) files.push(p);
  }
})(ROOT + ".shared-kernel");

const CONST_DECL =
  /(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*(?::[^=]*)?=\s*(?:Object\.freeze\(\s*)?[[{]([\s\S]*?)[\]}]\s*(?:as const|\)\s*as const|as const\s*\))/g;

const seen = new Set();
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(CONST_DECL)) {
    const name = m[1], body = m[2];
    const lits = [...body.matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map(x => x[1]);
    if (lits.length < 2) continue;
    const set = new Set(lits);
    for (const [en, ev] of Object.entries(enums)) {
      if (new RegExp(en + "Value").test(body)) continue; // derived, not a dubel
      const inter = [...set].filter(v => ev.has(v));
      if (inter.length < 2 || inter.length / ev.size < 0.5) continue;
      const key = `${en}|${f.slice(ROOT.length)}|${name}`;
      if (!seen.has(key)) { seen.add(key); console.log(key); }
    }
  }
}
NODE
)

DISCOVERED_COUNT=$(printf '%s' "$DISCOVERED" | grep -c . || true)
if [[ "$DISCOVERED_COUNT" -eq 0 ]]; then
  VIOLATIONS=$((VIOLATIONS + 1))
  print_error "Discovery found ZERO mirror candidates in .shared-kernel — parser broken; a green here would be green over emptiness"
fi

B_OK=0
B_FOUND=""
while IFS= read -r ENTRY; do
  [[ -z "$ENTRY" ]] && continue
  ENUM="${ENTRY%%|*}"
  REST="${ENTRY#*|}"
  REL_FILE="${REST%%|*}"
  CONST="${REST##*|}"
  FILE="${ROOT}/${REL_FILE}"
  B_FOUND="${B_FOUND}${CONST}|${ENUM}"$'\n'

  if is_exempt "$ENUM"; then
    print_info "skip ${CONST} ~ ${ENUM} (enum owned by a dedicated audit)"
    continue
  fi

  SCHEMA_VALS=$(extract_schema_enum "$ENUM")
  DUBEL_VALS=$(extract_dubel_values "$FILE" "$CONST")

  if [[ -z "$DUBEL_VALS" ]]; then
    VIOLATIONS=$((VIOLATIONS + 1))
    print_error "${ENUM}: could not extract ${CONST} from ${REL_FILE} (shape changed — update enum-parity.sh)"
  elif [[ "$SCHEMA_VALS" != "$DUBEL_VALS" ]]; then
    VIOLATIONS=$((VIOLATIONS + 1))
    print_error "${ENUM} DRIFT — schema enum != ${CONST} (${REL_FILE})"
    report_drift "schema enum" "${CONST}" "$SCHEMA_VALS" "$DUBEL_VALS"
    print_info  "  Fix: align ${CONST} with the schema enum (hand-maintained — TSC will NOT catch this)."
  else
    B_OK=$((B_OK + 1))
    print_success "${CONST} == enum ${ENUM} (${REL_FILE})"
  fi
done <<< "$DISCOVERED"

# Existence assertion: a known mirror that discovery stopped seeing = lost
# coverage, and lost coverage must be LOUD, not a quietly shorter list.
for ANCHOR in "${MUST_DISCOVER[@]}"; do
  if ! grep -qxF "$ANCHOR" <<< "$B_FOUND"; then
    VIOLATIONS=$((VIOLATIONS + 1))
    print_error "ANCHOR LOST — ${ANCHOR%%|*} (~ ${ANCHOR##*|}) is no longer auto-discovered"
    print_info  "  Either it was renamed/moved/reshaped (fix discovery or the anchor), or the mirror"
    print_info  "  genuinely disappeared (drop the MUST_DISCOVER entry — deliberately, in this file)."
  fi
done

print_separator

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo ""
  print_error "enum-parity audit FAILED — ${VIOLATIONS} drift issue(s)"
  echo ""
  exit 1
fi

print_success "enum-parity audit PASSED — every Prisma enum agrees with the kernel"
exit 0
