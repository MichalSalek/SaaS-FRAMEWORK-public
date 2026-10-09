#!/bin/bash

# No-op Validation Allowlist Ratchet (BDX W2.5d — contract-DX)
#
# WHY: A no-op validator — `validate: () => ({ __isValid: true })`,
# `validationFunction: () => ({ __isValid: true })`, or `NO_VALIDATION` — disables
# the request-body validation gate. For a GET / query handler that reads NO body
# this is fine (nothing to validate). For a WRITE-METHOD handler (POST/PUT/PATCH/
# DELETE) it is a SECURITY-SENSITIVE choice: the body either is genuinely empty
# (the action derives everything from the authenticated session) OR it is
# validated by a hand-rolled in-handler type-guard. Either way the no-op MUST be a
# DELIBERATE, JUSTIFIED decision — never an accidental "forgot to add a validator".
#
# WHAT THIS RATCHET ENFORCES:
#   Every WRITE-METHOD endpoint whose body validation is a no-op MUST appear in the
#   KNOWN_NOOP_VALIDATION allowlist below, each with a one-line justification. A
#   write-method no-op endpoint NOT on the list = FAIL (new accidental gap). This
#   is the ratchet: the list can only SHRINK (as endpoints gain real validators) —
#   any NEW unlisted write-method no-op is blocked at commit time.
#
# SCOPE: GET / query no-ops are intentionally NOT enforced (no body to validate).
# Only POST/PUT/PATCH/DELETE no-ops are body-reading and thus on the hook.
#
# RED-FIRST proof (manual): add `validate: () => ({ __isValid: true })` to any POST
# handler NOT on the list → this script exits 1; revert → exits 0.

set -euo pipefail

source "$(dirname "$0")/_utils.sh"

print_boxed_header "NO-OP VALIDATION ALLOWLIST" "🔒"

PROJECT_ROOT=$(get_project_root)
API_DIR="$PROJECT_ROOT/web-1/src/pages/api"

if [[ ! -d "$API_DIR" ]]; then
    print_error "API directory not found at $API_DIR"
    exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# ALLOWLIST — write-method (POST/PUT/PATCH/DELETE) endpoints whose body validation
# is a justified no-op. Key = path relative to web-1/src/pages/api (the SSOT route
# identity). Each entry MUST carry a one-line reason. This list can only SHRINK.
# ─────────────────────────────────────────────────────────────────────────────
declare -A KNOWN_NOOP_VALIDATION=(
    # POST — bodyless: the action derives everything from the authenticated session
    # (session.userId) and reads no request body at all.
    ["v1/pairing/issue-session/index.ts"]="POST, bodyless — stylist issues a pairing QR for their own account (session-derived); no body fields."
    ["v1/pairing/revoke-all-sessions/index.ts"]="POST, bodyless — revokes all of the caller's own pairing sessions (session-derived); no body fields."
    ["v1/stripe/portal.ts"]="POST, bodyless — opens the Stripe billing portal for the authenticated user (session-derived); no body fields."
    ["v1/account/dismiss-gallery-strength/index.ts"]="POST, bodyless — stylistka zamyka własną kartę „Siła galerii\" (konto z sesji, data z serwera); brak pól w ciele."
    ["v1/user/export-data/index.ts"]="POST, bodyless — exports the caller's own data (session.userId); no body fields."

    # POST — bodyless, admin: target identity comes from the impersonation token /
    # session (req-level), NOT a JSON body.
    ["v1/admin/refresh-impersonation/index.ts"]="POST, bodyless — refreshes the admin's own become-user token from the request/session (out-of-band header); no body fields."
    ["v1/admin/switch-back-become-user/index.ts"]="POST, bodyless — switches the admin back from become-user via the request token; no body fields."

    # DELETE — bodyless: the target staffId comes from the dynamic route param
    # ([staffId]), not a body.
    ["v1/salon/staff/[staffId]/delete/index.ts"]="DELETE, bodyless — target staff id comes from the [staffId] route param; no body fields."

    # POST — reads body.id but the no-op is REQUIRED (validation-coverage.sh only
    # accepts the literal no-op or VALIDATION_POLICY.validators.X, never an inline
    # validator); the type-guard is hoisted to the head of the handler (rejects any
    # non-string id with 400 before it can reach the deleteMany where-clause). See
    # the DECISION comment in the file.
    ["v1/session/delete/all/index.ts"]="POST, body.id guarded inline at handler head (operator-injection defence); literal no-op mandated by validation-coverage.sh."

    # POST (RFC 8058 One-Click List-Unsubscribe) + GET (link click from the email) in
    # ONE handler, method computed: `contestedHTTPMethod: isPost ? 'post' : 'get'`.
    # The no-op is the DELIBERATE fix for finding C2 (HTML-contract deviation) — quoted
    # from the DECISION comment in the file: a format validator short-circuits a malformed
    # token to a 400 application/json BEFORE businessLogic, which breaks the GET-from-email
    # contract (the user gets raw JSON instead of renderNewsletterLandingHtml). "Token jest
    # granicą bezpieczeństwa (HMAC-podpisany), nie jego długość" — a garbage token now
    # reaches businessLogic → verifyNewsletterUnsubscribeToken returns null → INVALID_TOKEN
    # → GET renders friendly HTML, POST returns machine-readable JSON. Cost: one constant-time
    # HMAC verification on a STRICT rate-limited endpoint.
    ["v1/public/newsletter-unsubscribe/index.ts"]="POST+GET (computed method), single body field \`token\` = HMAC-signed security boundary verified in businessLogic; no-op deliberate (finding C2) so a malformed token renders the HTML page instead of a 400 JSON short-circuit."
)

# ─────────────────────────────────────────────────────────────────────────────
# Discovery: find every endpoint file with a no-op validator (either handler style:
# defineHandler `validate:` or raw HTTPRequestHandlerMiddleware `validationFunction:`).
# Patterns mirror validation-coverage.sh's NOOP detection.
# ─────────────────────────────────────────────────────────────────────────────
NOOP_FILES=$(grep -rlE \
    "(validate|validationFunction):[[:space:]]*\(\)[[:space:]]*=>[[:space:]]*\([[:space:]]*\{[[:space:]]*__isValid:[[:space:]]*true|(validate|validationFunction):[[:space:]]*NO_VALIDATION" \
    "$API_DIR" 2>/dev/null | sort || true)

FAILURES=0
LISTED_WRITE=0
SKIPPED_QUERY=0
STALE_ALLOWLIST=()

# Track which allowlist keys we actually matched (to detect stale entries).
declare -A SEEN_KEYS=()

for file in $NOOP_FILES; do
    rel="${file#$API_DIR/}"

    # Strip comments (block then line) so prose mentioning patterns/method strings
    # in DECISION comments cannot false-match the detection below. Mirrors
    # validation-coverage.sh's comment-strip order.
    code=$(sed '/\/\*/,/\*\//d' "$file" | sed 's|//.*$||g')

    # Determine declared HTTP method(s). defineHandler uses `method: '<m>'`;
    # raw middleware uses `contestedHTTPMethod: '<m>'`. A multi-method dispatcher
    # (e.g. salon/staff/index.ts) may declare several.
    #
    # DECISION (nie usuwaj tego komentarza): wykrywanie metody rozszerzone z formy
    # LITERALNEJ (`method:` + od razu apostrof) na CAŁE wyrażenie deklaracji. Stara
    # regexka wymagała cudzysłowu tuż po dwukropku, więc metoda POLICZONA uciekała
    # bokiem: `contestedHTTPMethod: isPost ? 'post' : 'get'`
    # (v1/public/newsletter-unsubscribe/index.ts) nie pasował do niczego, więc
    # endpoint z no-op walidatorem lądował po cichu w koszyku „GET, skipped" —
    # a jest to endpoint POST (RFC 8058 One-Click List-Unsubscribe) i nie było go na
    # allowliście. Zmierzone: przed zmianą 8 write-endpointów / 55 pominiętych,
    # po zmianie 9 / 54.
    # Zasada: bierzemy wartość deklaracji do pierwszego przecinka (ternary nie ma
    # przecinka) i jeśli pada w niej JAKAKOLWIEK metoda zapisu — traktujemy endpoint
    # jako zapisowy (konserwatywnie: gałąź POST realnie czyta body).
    method_decls=$(grep -oiE "(method|contestedHTTPMethod):[^,]*" <<<"$code" || true)
    methods=$(grep -oiE "'(post|put|patch|delete)'" <<<"$method_decls" || true)

    if [[ -z "$methods" ]]; then
        # No write method declared → GET/query no-op → not body-reading → skip.
        SKIPPED_QUERY=$((SKIPPED_QUERY + 1))
        continue
    fi

    # SPECIAL CASE — multi-method dispatcher: a file declaring 2+ HTTP methods
    # (GET+POST in one handler, e.g. salon/staff/index.ts) where a REAL validator
    # (VALIDATION_POLICY.validators.X) guards the write branch → the no-op belongs
    # to its GET branch only, not a write-method body-reading concern. Both
    # conditions required (multi-method AND a real validator present in code) so a
    # single-method write handler that merely mentions the pattern in a comment is
    # NOT skipped.
    # Liczymy MIEJSCA deklaracji, nie literały: pojedyncza deklaracja policzona
    # (ternary GET/POST) to JEDEN dispatcher, nie dwa — nie może przez tylne drzwi
    # wpaść w skrót „multi-method" i wypaść ze skanu.
    method_decl_count=$(echo "$method_decls" | grep -c . || true)
    if [[ "$method_decl_count" -gt 1 ]] && grep -q "VALIDATION_POLICY.validators\." <<<"$code"; then
        SKIPPED_QUERY=$((SKIPPED_QUERY + 1))
        continue
    fi

    LISTED_WRITE=$((LISTED_WRITE + 1))

    if [[ -v "KNOWN_NOOP_VALIDATION[$rel]" ]]; then
        SEEN_KEYS["$rel"]=1
        echo -e "  ${GREEN}✓${NC} ${rel}"
        echo -e "      ${GRAY}${KNOWN_NOOP_VALIDATION[$rel]}${NC}"
    else
        FAILURES=$((FAILURES + 1))
        echo -e "  ${RED}✗ UNLISTED write-method no-op validator: ${rel}${NC}"
    fi
done

# Detect stale allowlist entries (listed but no longer a write-method no-op).
for key in "${!KNOWN_NOOP_VALIDATION[@]}"; do
    if [[ ! -v "SEEN_KEYS[$key]" ]]; then
        STALE_ALLOWLIST+=("$key")
    fi
done

echo ""
echo "  Write-method no-op endpoints: $LISTED_WRITE (allowlisted)"
echo "  Query/GET no-op endpoints skipped (no body): $SKIPPED_QUERY"
echo "  Allowlist size: ${#KNOWN_NOOP_VALIDATION[@]}"

if [[ ${#STALE_ALLOWLIST[@]} -gt 0 ]]; then
    print_warning "Stale allowlist entries (no longer a write-method no-op — remove them):"
    for s in "${STALE_ALLOWLIST[@]}"; do
        echo -e "    ${YELLOW}- ${s}${NC}"
    done
    # Stale entries are a soft warning by default, but a removed handler should
    # prompt cleanup. Treat as failure to keep the ratchet honest (list can only
    # shrink — a stale entry means the file changed and the entry must be pruned).
    FAILURES=$((FAILURES + ${#STALE_ALLOWLIST[@]}))
fi

if [[ $FAILURES -gt 0 ]]; then
    echo ""
    print_error "No-op validation allowlist ratchet FAILED ($FAILURES problem(s))"
    echo -e "${YELLOW}   A WRITE-METHOD endpoint has a no-op body validator that is not justified.${NC}"
    echo -e "${YELLOW}   FIX (pick one):${NC}"
    echo -e "${YELLOW}     1. Add a real validator: validate: VALIDATION_POLICY.validators.<x>${NC}"
    echo -e "${YELLOW}     2. If the body is genuinely empty / guarded inline, add the path to${NC}"
    echo -e "${YELLOW}        KNOWN_NOOP_VALIDATION in this file with a one-line justification.${NC}"
    echo -e "${YELLOW}     3. If a listed file was removed/changed, prune its stale allowlist entry.${NC}"
    exit 1
fi

print_success "All $LISTED_WRITE write-method no-op endpoints are justified (allowlist clean)"
exit 0
