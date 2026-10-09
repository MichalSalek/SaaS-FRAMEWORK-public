#!/usr/bin/env bash
# dead-exports.sh — Guard: zero NEW dead (unused) exports in web-1/src, .shared-kernel/ AND main/src.
#
# INTENT (BDX W1.8, kernel-extension 2026-07):
#   Dead exports rot: they keep imports/deps alive, mislead refactors ("this is
#   public API"), and inflate the surface ts-prune/grep must walk. This ratchet
#   runs ts-prune over web-1, strips the structural noise, removes a documented
#   allowlist of legit-retained / framework / barrel-re-export findings, and
#   FAILS if anything remains. Baseline after the W1.8 sweep = 0.
#   PART 2 sweeps .shared-kernel/ (the SOURCE, not the READONLY copies) with a
#   repo-wide grep-liveness check — see its section header below.
#
# WHAT IT CHECKS (PART 1):
#   `npx ts-prune -p tsconfig.json` over web-1 (READONLY kernel COPY not scanned —
#   it is propagated read-only; the kernel SOURCE is swept in PART 2).
#   Structural filters drop:
#     - src/pages/**          → Next.js route/handler entry-points (framework-invoked)
#     - "(used in module)"    → used internally, only the export keyword is spare
#     - "- default"           → default re-exports (page modules / configs)
#     - "*.d.ts"              → ambient decls
#     - "- satisfies"         → ts-prune artifact for `satisfies` expressions (not an export)
#     - READONLY-shared-kernel → kernel copy, out of BDX scope
#   Then the ALLOWLIST (below) removes each known legit finding by export name.
#   Any line left over = a NEW dead export → fail.
#
# RED-FIRST verified (W1.8): adding `export const __deadExportRatchetProbe = 1`
#   to a web-1 source file made this script exit 1 with the probe listed; removing
#   it restored exit 0.
#
# ADDING TO THE ALLOWLIST: only for (a) owner-retained future-use exports carrying
#   a DECISION/retention comment at the definition site, (b) framework entry-points
#   (Next.js instrumentation `register`), (c) barrel re-exports of kernel symbols
#   surfaced through a web-1 `export *` / `export { ... } from '@kernel/...'` file,
#   or (d) a public-API create/verify pair whose counterpart is already wired.
#   Each entry MUST carry a 1-line rationale. New genuinely-dead code → DELETE it,
#   do NOT allowlist.
set -euo pipefail
source "$(dirname "$0")/_utils.sh"

PROJECT_ROOT=$(get_project_root)

print_boxed_header "DEAD EXPORTS AUDIT (web-1 ts-prune + kernel sweep + main knip)" "🪦"

WEB1_FAIL=0
KERNEL_FAIL=0

# ════════════════════════════════════════════════════════════════════
# PART 1: web-1/src (ts-prune)
# ════════════════════════════════════════════════════════════════════
cd "$PROJECT_ROOT/web-1"

SKIP_TSPRUNE=0
if [[ ! -d node_modules/ts-prune ]]; then
  print_warning "ts-prune nie zainstalowany (devDep) — pomijam część web-1 (kernel sweep i tak działa)."
  SKIP_TSPRUNE=1
fi

# ── ALLOWLIST: PATH-ANCHORED legit-retained / framework / barrel re-export findings.
#    Each line: `relative/path.ts - exportName`  # 1-line rationale.
#    DECISION (nie usuwaj tego komentarza): entries are anchored to FILE PATH + name,
#    not name alone. A bare-name allowlist masks a brand-new genuinely-dead export
#    that happens to share an allowlisted name in a DIFFERENT file (verified: a fresh
#    dead `getSubject` added elsewhere slipped through the name-only match). Matching
#    `path - name` exempts a name ONLY in its real definition site. The volatile
#    `:LINE` segment is stripped from each ts-prune finding before matching, so the
#    allowlist survives line shifts (the path is the stable identity).
ALLOWLIST=(
  # (a) Owner-retained future-use (DECISION/retention comment at definition site)
  "src/domain/admin/admin.utils.api.ts - adminRevokeImpersonationBackup_IO"  # retained entry-point for future admin-UI kill switch (DECISION at def site; moved from impersonation ops to shrink god-file)
  "src/application/event-log/event-log.config.ts - MAX_EVENT_LOGS_PER_USER"                             # intended per-user EventLog retention bound for the future LIFO trim sweep; SSOT referenced by the failed-login DECISION

  # (b) Framework entry-point (auto-invoked, never imported)
  "src/instrumentation.ts - register"                  # Next.js instrumentation.ts hook — called by the Next runtime at boot

  # (c) Barrel re-exports of kernel symbols (web-1 file `export *` / re-export from @kernel; real consumers import via other paths / live in main/)
  "src/application/http/http.types.ts - HTTPError"                          # @app/http/http.types re-export of kernel http type
  "src/application/http/http.types.ts - HTTPSuccess"                        # @app/http/http.types re-export of kernel http type
  "src/application/http/http.types.ts - DetailedErrorGeneric"               # @app/http/http.types re-export of kernel type (DetailedErrorPayload base)
  "src/application/http/http.types.ts - DetailedErrorPayload"               # @app/http/http.types re-export consumed by 40+ kernel DTOs via relative '../../application/http/http.types'
  "src/application/interceptors/domain-interceptors.ts - GetCurrentUserOutputOptimistic"  # domain-interceptors barrel re-export — used in 27 source files
  "src/application/stripe/stripe.config.ts - SUBSCRIPTION_STATUS"           # @app/stripe/stripe.config `export *` surfacing kernel const
  "src/application/stripe/stripe.config.ts - STRIPE_ACTIVE_STATUSES"        # @app/stripe/stripe.config `export *` surfacing kernel const
  "src/application/stripe/stripe.config.ts - PLAN_ID_MAP"                   # @app/stripe/stripe.config `export *` surfacing kernel const (imported elsewhere)
  "src/application/stripe/stripe.config.ts - PlanId"                        # @app/stripe/stripe.config `export *` surfacing kernel type
  "src/application/stripe/stripe.config.ts - EMAIL_OFFERS"                   # @app/stripe/stripe.config `export *` surfacing kernel const (imported from @kernel)
  "src/domain/account/account.config.ts - StylistAccountWhereInput"         # account.config.ts `satisfies Prisma.StylistAccountWhereInput` — type artifact, not a real export
  "src/domain/session-container/operations/session-container.operations.ts - loadSessionDetail_IO"  # ts-prune resolution artifact — actually imported+called in 2 sibling session-container ops files

  # (d) Public-API create/verify pair whose counterpart is already wired
  "src/application/email-handler/newsletter-unsubscribe.token.ts - createNewsletterUnsubscribeToken"  # create-side of newsletter unsubscribe HMAC pair (verify-side wired at unsubscribe endpoint); retained for pending broadcast feature

  # (e) Pre-existing dead-with-migration-context / cohesive public helper surface (out of W1.8 delete mandate; carry adjacent DECISION/phase notes)
  "src/domain/email/email.types.ts - parseEmailPreferences"                # email_preferences JSON parser — shadow of PRMA Phase-2/3 rollback-safety column (DECISION at def site)
  "src/application/admin/admin.utils.api.ts - isEmailAddressProhibited"     # admin email-policy helper — public admin.utils.api surface
  "src/domain/newsletter/operations/newsletter-subscribe.operations.ts - NewsletterSubscribeError"  # exported error-type alias on newsletter-subscribe operation public surface
  "src/application/http/http.client.types.ts - IOClientFunctionReqResErr"   # generic IO client function type — public http.client.types surface
  "src/application/email-handler/email-template.content.ts - BodyGenerator" # email-template body-generator type — used same-file by BODY_TEMPLATES Record value type

)

# Build the exact-match allowlist set (one `path - name` per line, comments stripped).
ALLOW_SET="$(printf '%s\n' "${ALLOWLIST[@]}" | sed 's/[[:space:]]*#.*//; s/[[:space:]]*$//' | grep -v '^$')"

if [[ "$SKIP_TSPRUNE" -eq 0 ]]; then
  RAW="$(npx --no-install ts-prune -p tsconfig.json 2>/dev/null || true)"

  # Structural filters → drop framework/ambient/internal/kernel noise.
  # Then strip the volatile `:LINE` from each `path:LINE - name` finding so it matches
  # the path-anchored allowlist, and drop exact `path - name` allowlist hits via
  # `grep -vxF` (fixed-string, whole-line — a name is exempt ONLY in its real path).
  STRUCTURAL="$(printf '%s\n' "$RAW" \
    | grep -vE '^src/pages/' \
    | grep -v '(used in module)' \
    | grep -vE ' - default$' \
    | grep -vE '\.d\.ts:' \
    | grep -vE ' - satisfies$' \
    | grep -v 'READONLY-shared-kernel' \
    | sed -E 's/:[0-9]+ - / - /' \
    | grep -vE '^[[:space:]]*$' || true)"

  # ── ASERCJA ISTNIENIA KOTWIC ────────────────────────────────────────────────
  # DECISION (nie usuwaj tego komentarza): kazdy wpis ALLOWLIST musi DZIS trafiac
  # w realne znalezisko ts-prune. Martwa kotwica nie zwalnia niczego — jest tylko
  # zapisem stanu, ktory minal, i cicha zacheta, zeby liste rozbudowywac zamiast
  # czyscic. Wzorzec przejety z `button-primitives.sh` (S113).
  # POMIAR: przed = 30 wpisow, z czego 7 nie trafialo w nic (23 zywe). Trzy z nich
  # nosily wprost adnotacje „currently used — anchor kept for re-emergence", czyli
  # zwolnienie trzymane NA ZAPAS: dokladnie ten ksztalt, ktory ratchet ma
  # wykluczac, bo z gory przepuszcza przyszla smierc tego eksportu bez decyzji.
  # Usuniete wszystkie 7; jesli ktorykolwiek wroci jako martwy, bramka zapali sie
  # na czerwono i ktos SWIADOMIE dopisze kotwice z powodem. Po = 23 wpisy, 23 zywe.
  STALE_ANCHORS=""
  while IFS= read -r entry; do
    [[ -z "$entry" ]] && continue
    grep -qxF "$entry" <<< "$STRUCTURAL" || STALE_ANCHORS="${STALE_ANCHORS}${entry}"$'\n'
  done <<< "$ALLOW_SET"

  if [[ -n "${STALE_ANCHORS//[[:space:]]/}" ]]; then
    STALE_COUNT="$(printf '%s\n' "$STALE_ANCHORS" | grep -c . || true)"
    print_error "web-1: ${STALE_COUNT} MARTWA(YCH) KOTWICA(E) w ALLOWLIST — wpis, ktory nie zwalnia niczego:"
    printf '%s\n' "$STALE_ANCHORS" | grep . | sed 's/^/  /'
    print_info "Fix: usun te wpisy z ALLOWLIST w tests/audit/dead-exports.sh — eksport zyje albo zniknal."
    WEB1_FAIL=1
  fi

  FILTERED="$(printf '%s\n' "$STRUCTURAL" | grep -vxF "$ALLOW_SET" | grep -vE '^[[:space:]]*$' || true)"

  COUNT="$(printf '%s\n' "$FILTERED" | grep -vE '^[[:space:]]*$' | grep -c . || true)"
  BASELINE=0

  if [[ "$COUNT" -le "$BASELINE" ]]; then
    print_success "web-1: zero martwych eksportów (po filtrze + allowlist). Baseline=${BASELINE}."
  else
    print_error "web-1: wykryto ${COUNT} NOWY(CH) martwy(ch) eksport(ów) ponad baseline=${BASELINE}:"
    printf '%s\n' "$FILTERED" | sed 's/^/  /'
    print_info "Fix: USUŃ martwy eksport (zweryfikuj 0-ref cross-package: web-1/src + main/src + tests/ PRZED usunięciem)."
    print_info "Jeśli to legit-retained/framework/barrel re-export/public-API — dopisz do ALLOWLIST w tests/audit/dead-exports.sh z 1-liniowym uzasadnieniem."
    WEB1_FAIL=1
  fi
fi

# ════════════════════════════════════════════════════════════════════
# PART 2: .shared-kernel/ (grep-liveness, repo-wide)
# ════════════════════════════════════════════════════════════════════
# DECISION (nie usuwaj tego komentarza): kernel SOURCE sweep jest grep-based, NIE
# ts-prune — kernel nie jest osobnym projektem tsconfig, a jego konsumenci importują
# przez KOPIE READONLY-shared-kernel w main/ i web-1/. Dlatego liveness = repo-wide:
#   Faza A: nazwa eksportu użyta gdziekolwiek w web-1/src, main/src, tests/, scripts/
#           (z WYŁĄCZENIEM katalogów READONLY-shared-kernel — tam siedzi tylko KOPIA
#           definicji, nie konsumpcja) → ŻYWY. To pokrywa regułę "eksport kernela
#           użyty przez kopię READONLY = ŻYWY".
#   Faza B: nazwa nieużyta przez konsumentów, ale występująca w .shared-kernel/*.ts
#           więcej niż 1 raz (definicja) → używana wewnątrz kernela (odpowiednik
#           ts-prune "(used in module)" / intra-kernel import) → ŻYWY.
#   Reszta = MARTWY eksport → fail (chyba że na KERNEL_ALLOWLIST niżej).
# Wyłączenia z ekstrakcji:
#   - db_models.generated.dto.ts — generowany 1:1 ze schema.prisma (audit:dto pilnuje
#     świeżości); "martwy" typ tam = nieużywany MODEL DB, nie hygiene eksportów, a regen
#     i tak by go przywrócił.
#   - node_modules wewnątrz kernela (dayjs-era leftover może wrócić z npm i).
# Ograniczenie (świadome): grep po tokenach = konserwatywny. Nazwa w komentarzu /
# stringu konsumenta liczy się jako użycie (false-alive możliwy, false-dead nie).

KERNEL_DIR="$PROJECT_ROOT/.shared-kernel"
TMP_KERNEL=$(mktemp -d)
trap 'rm -rf "$TMP_KERNEL"' EXIT

# ── KERNEL_ALLOWLIST: ERE patterns (whole-line, `relpath - name`), each with rationale.
#    Same policy as PART 1: genuinely-dead → DELETE; allowlist only deliberate surface.
KERNEL_ALLOWLIST=(
  # Compile-time zod↔DTO binding guards (FWE Wave H): `type XRequestSchemaBindings =
  # { EVT: SchemaMatchesDto<...> }` errors AT DECLARATION on schema/DTO drift — the
  # type is a static assertion, "unused" by design.
  '^policies/validation/[a-z0-9-]+\.validation\.ts - [A-Za-z0-9]+RequestSchemaBindings$'
  # Systematic derived-type surface: NAME/PATH/TYPE triple per route-group, 1:1 z
  # routing.config SSOT — symmetry by design, holes would make the surface lie.
  '^domain/routing/routing\.types\.ts - ROUTES_[A-Z_]+$'
  # Cohesive narrower family (models/type_narrowing.ts): one `is*Narrower` per kernel
  # union — symmetric public surface, siblings in active use.
  '^models/type_narrowing\.ts - is[A-Za-z]+Narrower$'
  # Cohesive session-lifecycle predicate family (isActive/isTerminal in use).
  '^domain/session-container/session-container\.types\.ts - isDraftSession$'
  # Checker for live staff-permission config (DEFAULT_PERMISSIONS_BY_ROLE persisted
  # via salon-staff ops); enforcement wiring pending — intended SSOT check API.
  '^domain/user-and-account/staff_accounts\.config\.ts - hasStaffPermission$'
  # PlanConfig seed surface with DECISION comment (config-only column foot-gun);
  # DB-seed path retired to PRICING_POLICY runtime SSOT — owner-retained shape.
  '^domain/pricing/planConfig\.seed\.ts - PLAN_CONFIG_SEED_DATA$'
  # Dormant platform-gate escape hatch (pair with PLATFORM_GATE_BYPASS_STORAGE_KEY,
  # documented in tests/audit/storage-keys.sh allowlist; PLATFORM_CONFIG.GATE_ENABLED).
  '^domain/platform/platform\.config\.ts - PLATFORM_GATE_BYPASS_PARAM$'
)
printf '%s\n' "${KERNEL_ALLOWLIST[@]}" > "$TMP_KERNEL/allowlist.ere"

# Extract exported top-level names (declaration forms only; `export {}`/`export *`
# re-exports pominięte — konserwatywnie traktowane jako użycia, nie definicje).
grep -rhoE --include='*.ts' --exclude-dir=node_modules --exclude='db_models.generated.dto.ts' \
  '^export (declare )?(abstract )?(async )?(const enum|const|let|var|function|type|interface|class|enum) [A-Za-z_][A-Za-z0-9_]*' \
  "$KERNEL_DIR" | awk '{print $NF}' | sort -u > "$TMP_KERNEL/names.txt"

# Faza A: konsumenci (jedno przejście grep -F po całym drzewie konsumenckim).
# `-a`: pojedyncze pliki testowe z bajtami kontrolnymi (security vectors) nie mogą
# wypaść jako "binary file matches" — zjadłoby to użycia.
{ grep -rahoFwf "$TMP_KERNEL/names.txt" \
  "$PROJECT_ROOT/web-1/src" "$PROJECT_ROOT/main/src" "$PROJECT_ROOT/tests" "$PROJECT_ROOT/scripts" \
  --include='*.ts' --include='*.tsx' \
  --exclude-dir='READONLY-shared-kernel' --exclude-dir='node_modules' \
  || true; } | sort -u > "$TMP_KERNEL/alive.txt"

comm -23 "$TMP_KERNEL/names.txt" "$TMP_KERNEL/alive.txt" > "$TMP_KERNEL/candidates.txt"

# Faza B: kandydaci — użycie wewnątrz kernela (>1 wystąpienie = definicja + użycie).
: > "$TMP_KERNEL/dead.txt"
while IFS= read -r name; do
  [[ -z "$name" ]] && continue
  occurrences=$(grep -rhow -a --include='*.ts' --exclude-dir=node_modules "$name" "$KERNEL_DIR" | wc -l)
  if [[ "$occurrences" -le 1 ]]; then
    def_file=$({ grep -rlwE --include='*.ts' --exclude-dir=node_modules \
      "^export (declare )?(abstract )?(async )?(const enum|const|let|var|function|type|interface|class|enum) $name" \
      "$KERNEL_DIR" 2>/dev/null || true; } | head -1)
    rel="${def_file#"$KERNEL_DIR"/}"
    echo "${rel:-unknown} - $name" >> "$TMP_KERNEL/dead.txt"
  fi
done < "$TMP_KERNEL/candidates.txt"

KERNEL_FILTERED="$(grep -vEf "$TMP_KERNEL/allowlist.ere" "$TMP_KERNEL/dead.txt" || true)"
KERNEL_COUNT="$(printf '%s\n' "$KERNEL_FILTERED" | grep -c . || true)"

if [[ "$KERNEL_COUNT" -eq 0 ]]; then
  print_success "kernel: zero martwych eksportów w .shared-kernel (repo-wide liveness + allowlist). Baseline=0."
else
  print_error "kernel: wykryto ${KERNEL_COUNT} martwy(ch) eksport(ów) w .shared-kernel:"
  printf '%s\n' "$KERNEL_FILTERED" | sed 's/^/  /'
  print_info "Fix: USUŃ eksport z .shared-kernel + npm run system:kernel (propagacja kopii READONLY)."
  print_info "Świadoma powierzchnia (guard-type / rodzina / retained)? → dopisz pattern do KERNEL_ALLOWLIST z uzasadnieniem."
  KERNEL_FAIL=1
fi

# ════════════════════════════════════════════════════════════════════
# PART 3: main/src (knip --include exports,types)
# ════════════════════════════════════════════════════════════════════
# DECISION (nie usuwaj tego komentarza):
#   SLEPA PLAMA ZAMKNIETA — ten straznik deklarowal w naglowku „web-1/src AND
#   .shared-kernel/", i tyle wlasnie robil. `main/src` (954 pliki .ts/.tsx,
#   czyli WIEKSZA polowa kodu produktu) nie mial ZADNEJ bramki na martwe
#   eksporty: siostrzany `dead-code.sh` liczy tam wylacznie nieosiagalne PLIKI
#   (`knip --include files`) i wprost zapisuje, ze eksporty sa „tracked
#   separately" — tyle ze nie byly trackowane nigdzie.
#   POMIAR (knip w main/, przed): 15 nieuzywanych eksportow + 14 nieuzywanych
#   typow = 29 znalezisk, zero bramek.
#   NARZEDZIE: knip, nie ts-prune — main/ ma knip w devDeps i wlasny knip.json
#   (projekt + ignore READONLY), a ts-prune tam nie istnieje. Uzycie tego samego
#   configu co dead-code.sh trzyma zakres w JEDNYM miejscu.
#   FILTR ROWNOWAZNY: do knip.json doszlo `"ignoreExportsUsedInFile": true` —
#   odpowiednik filtra `(used in module)` z PARTU 1. Bez tego 27 z 29 znalezisk
#   to eksporty uzywane we WLASNYM pliku (zmierzone: cala czworka loaderow
#   z `application/fonts.ts` jest konsumowana przez `FONT_VARIABLE_CLASSNAMES`
#   dwie linie nizej), czyli „zbedne slowo export", a nie martwy kod — bramka
#   z takim szumem uczy dopisywania do baseline'u zamiast sprzatania.
#   Opcja NIE zmienia `dead-code.sh` (ten liczy pliki; zweryfikowane: nadal zielony).
#   PO FILTRZE: 2 realnie martwe cross-file eksporty, oba na MAIN_ALLOWLIST
#   ponizej z uzasadnieniem klasy (e) z PARTU 1 (spojna rodzina, rodzenstwo
#   w uzyciu) — baseline = 0, wiec KAZDE nowe znalezisko zapala bramke.
MAIN_FAIL=0
cd "$PROJECT_ROOT/main"

# Kotwice `relative/path - name`, kazda z 1-liniowym uzasadnieniem.
MAIN_ALLOWLIST=(
  "src/application/date/date.utils.ts - formatDateLongPL"                  # symetryczna rodzina wrapperow pl-PL nad format*; rodzenstwo zywe (formatDateShortPL 10 uzyc, formatTimestampPL 5, formatDateLong 6) — dziura w trojce klamalaby o powierzchni
  "src/UI/shared/image/imageUpload.config.ts - AcceptedImageMimeType"      # typ wyprowadzony z ACCEPTED_IMAGE_MIME_TYPES, tuz obok predykatu isAcceptedImageMimeType (2 konsumentow) — typowana powierzchnia tego samego SSOT
)
MAIN_ALLOW_SET="$(printf '%s\n' "${MAIN_ALLOWLIST[@]}" | sed 's/[[:space:]]*#.*//; s/[[:space:]]*$//' | grep -v '^$')"

if [[ ! -d node_modules/knip ]]; then
  print_warning "knip nie zainstalowany (devDep) — pomijam część main/src."
else
  # Reporter `compact` daje `path: name1, name2` — rozbijamy na `path - name`,
  # czyli ten sam ksztalt co PART 1, zeby allowlisty czytalo sie tak samo.
  MAIN_RAW="$(npx --no-install knip --include exports,types --no-progress --reporter compact 2>/dev/null \
    | grep -vE '^(Unused|[[:space:]]*$)' \
    | awk -F': ' 'NF>1 {n=split($2,a,", "); for(i=1;i<=n;i++) print $1 " - " a[i]}' \
    | sort -u || true)"

  # Asercja istnienia kotwic — ta sama zasada co w PARCIE 1.
  MAIN_STALE=""
  while IFS= read -r entry; do
    [[ -z "$entry" ]] && continue
    grep -qxF "$entry" <<< "$MAIN_RAW" || MAIN_STALE="${MAIN_STALE}${entry}"$'\n'
  done <<< "$MAIN_ALLOW_SET"

  if [[ -n "${MAIN_STALE//[[:space:]]/}" ]]; then
    MAIN_STALE_COUNT="$(printf '%s\n' "$MAIN_STALE" | grep -c . || true)"
    print_error "main: ${MAIN_STALE_COUNT} MARTWA(YCH) KOTWICA(E) w MAIN_ALLOWLIST — wpis, ktory nie zwalnia niczego:"
    printf '%s\n' "$MAIN_STALE" | grep . | sed 's/^/  /'
    print_info "Fix: usun te wpisy z MAIN_ALLOWLIST w tests/audit/dead-exports.sh."
    MAIN_FAIL=1
  fi

  MAIN_FILTERED="$(printf '%s\n' "$MAIN_RAW" | grep -vxF "$MAIN_ALLOW_SET" | grep -vE '^[[:space:]]*$' || true)"
  MAIN_COUNT="$(printf '%s\n' "$MAIN_FILTERED" | grep -c . || true)"

  if [[ "$MAIN_COUNT" -eq 0 ]]; then
    print_success "main: zero martwych eksportów w main/src (knip exports+types + allowlist). Baseline=0."
  else
    print_error "main: wykryto ${MAIN_COUNT} martwy(ch) eksport(ów) w main/src:"
    printf '%s\n' "$MAIN_FILTERED" | sed 's/^/  /'
    print_info "Fix: USUŃ eksport (albo samo słowo \`export\`, jeśli symbol jest używany w pliku)."
    print_info "Świadoma powierzchnia (spójna rodzina / retained)? → dopisz do MAIN_ALLOWLIST z 1-liniowym uzasadnieniem."
    MAIN_FAIL=1
  fi
fi

if [[ "$WEB1_FAIL" -eq 0 && "$KERNEL_FAIL" -eq 0 && "$MAIN_FAIL" -eq 0 ]]; then
  print_success "dead-exports: web-1 + kernel + main czyste."
  exit 0
fi
exit 1
