// SSOT: All validation constants used by validation.policy.ts
// Extract magic numbers and regex patterns to a single source of truth

// ── Regex patterns ──
export const VALIDATION_REGEX = {
  /**
   * WHY: Permissive but practical email regex — accepts all common local-part chars
   * (+, #, dots) without full RFC 5321 complexity. Full RFC allows edge cases no real
   * mail server accepts. Balanced: rejects obviously invalid, allows real-world addresses.
   *
   * DECISION: no nested quantifier. A nested form `([...]+[.][...]+)+` backtracks exponentially (a
   * short crafted string blocks the event loop), and newsletter/contact run this before Turnstile, so
   * it would be an unauthenticated DoS. This form backtracks at most quadratically and
   * validateEmail also caps input at EMAIL_MAX first.
   */
  EMAIL: /^[\w.\-#+]+@[\w.\-#]+\.[\w.\-#]+$/,
  /**
   * WHY: Used to collapse multiple consecutive whitespace characters into a single space
   * during input normalization. Global flag ensures all occurrences are replaced, not just
   * the first match.
   */
  WHITESPACE: /\s+/g,
  /**
   * WHY: Permissive phone format for stored/display phone numbers — allows international
   * prefixes (+), separators (spaces, dashes, parentheses) and digits. Intentionally loose
   * to accommodate diverse international formats without rejecting valid numbers.
   * ITU-T E.164 allows digits only, but UX requires user-friendly formatting.
   */
  PHONE_FORMAT: /^[0-9+\s()-]+$/,
  /**
   * WHY: Onboarding phone regex enforces a minimum of 9 digits (shortest valid national
   * number in Europe — Polish mobile numbers) and maximum 20 chars (ITU-T E.164 max 15
   * digits + prefix chars). Stricter than PHONE_FORMAT to block gibberish at registration.
   */
  PHONE_ONBOARDING: /^[\d\s\-+()]{9,20}$/,
  /**
   * Stored profile/contact phone: the permissive character set plus a real
   * digit count (9–15, ITU-T E.164). `PHONE_FORMAT` alone accepted `---` and
   * a `tel:` link with no number.
   */
  PHONE_MIN_DIGITS: 9,
  PHONE_MAX_DIGITS: 15,
  /**
   * WHY: Removes non-alphabetic, non-numeric, non-space, non-apostrophe characters from
   * free-text words. The 'u' flag enables full Unicode support for non-Latin scripts
   * (\p{L} = Unicode letters, \p{N} = Unicode numbers). Apostrophe preserved for names
   * like "O'Brien". Used for search normalization and tag generation.
   */
  UNICODE_WORD_CLEANUP: /[^\p{L}\p{N}\s']/gu,
  /**
   * WHY: Vanity URLs are public-facing identifiers in stylist profile URLs
   * (e.g. /stylist/anna-kowalska). Only lowercase ASCII alphanumerics and hyphens allowed —
   * no spaces, underscores, or Unicode — to ensure valid URL path segments without encoding,
   * and to keep URLs clean for SEO and sharing.
   */
  VANITY_URL_FORMAT: /^[a-z0-9-]+$/,
  /**
   * WHY: VAT invoice, Polish postal code in NN-NNN format (e.g. 00-950). The seller is a Polish
   * VAT payer and the company address is always PL, so the format is national (not the generic
   * international POSTAL_CODE_MAX). Goes to Stripe Customer.address.postal_code.
   */
  POSTAL_CODE_PL: /^\d{2}-\d{3}$/,
  /**
   * WHY: Validates CSS/HTML hex color codes in #RRGGBB format (6 hex digits, case-insensitive).
   * Shorthand (#RGB) not accepted — admin color management requires precise 6-digit codes
   * to avoid ambiguity. Used for trait/color admin panel validation.
   */
  HEX_COLOR: /^#[0-9A-Fa-f]{6}$/,
  /**
   * WHY: Instagram handle character allowlist per Instagram's own rules — letters, digits,
   * dots, and underscores only (no spaces, no @-prefix). Max length enforced separately
   * via VALIDATION_SOCIAL.INSTAGRAM_HANDLE_MAX. Matches Instagram's account name policy.
   */
  INSTAGRAM_HANDLE: /^[a-zA-Z0-9._]+$/,
} as const;

// ── String length constraints ──
export const VALIDATION_LENGTHS = {
  NAME_MIN: 2,
  NAME_MAX: 100,
  /**
   * WHY: Display name shown publicly on stylist profiles. Min 3 chars prevents trivially
   * short public names (UX: "AB" is not a meaningful salon name). Max 100 fits DB column
   * and UI card layouts without overflow.
   */
  DISPLAY_NAME_MIN: 3,
  DISPLAY_NAME_MAX: 100,
  /**
   * WHY: City name min 2 chars (some real city names are 2 chars, e.g. "Ła"). Max 100
   * covers the longest known city names globally (e.g. "Taumatawhakatangihangakoauauotamatea..."
   * in NZ is 85 chars) without excessive DB allocation.
   */
  CITY_MIN: 2,
  CITY_MAX: 100,
  /**
   * WHY: PHONE_MIN 9 = shortest valid national number in Poland and most EU countries.
   * PHONE_MAX 15 = ITU-T E.164 international standard maximum (country code + subscriber
   * number, digits only). PHONE_FIELD_MAX 20 = E.164 max (15 digits) + formatting chars
   * (spaces, dashes, parentheses, +) for stored display format. See also PHONE_ONBOARDING regex.
   */
  PHONE_MIN: 9,
  PHONE_MAX: 15,
  PHONE_FIELD_MAX: 20,
  /**
   * WHY: Vanity URLs appear in public-facing stylist URLs. Min 3 chars avoids trivially
   * short identifiers that clash with reserved path segments (e.g. "en", "pl"). Max 50
   * keeps URLs shareable and within typical browser address bar display limits without
   * truncation. Regex enforces lowercase alphanumeric + hyphen only (see VANITY_URL_FORMAT).
   */
  VANITY_URL_MIN: 3,
  VANITY_URL_MAX: 50,
  /**
   * WHY: Business/salon name stored in stylist profile. Max 100 consistent with NAME_MAX
   * and fits UI card layouts. No minimum — business name is optional on the profile.
   */
  BUSINESS_NAME_MAX: 100,
  /**
   * WHY: Street address can include building number, apartment, floor info. Max 200 covers
   * the longest real-world addresses without excessive DB allocation. Optional field.
   */
  STREET_MAX: 200,
  /**
   * WHY: Postal code formats vary internationally. Polish: "00-000" (6 chars). Longest
   * known postal codes are ~10 chars. Max 20 is generous to accommodate any international
   * format without truncation. Optional field.
   */
  POSTAL_CODE_MAX: 20,
  /**
   * WHY: Country of the stylist address (free text, defaults to "Poland" server-side, fed
   * to geocoding). Max 100 matches CITY_MAX: the longest official country names are ~60
   * chars. Optional field.
   */
  COUNTRY_MAX: 100,
  /**
   * WHY: VAT invoice, buyer company name (min 2 rejects empty/1-char, max 200 = Stripe
   * Customer.name limit). Goes 1:1 to Stripe Customer.name.
   */
  VAT_COMPANY_NAME_MIN: 2,
  VAT_COMPANY_NAME_MAX: 200,
  /**
   * WHY: VAT invoice, first line of the company address (street + number). Min 2 / max 200,
   * mapped to Stripe Customer.address.line1.
   */
  VAT_ADDRESS_LINE_MIN: 2,
  VAT_ADDRESS_LINE_MAX: 200,
  /**
   * WHY: Website URL stored as text. Max 200 covers typical URLs including path and query
   * params without excessive DB allocation. Validated separately for https scheme.
   * RFC 2616 recommends 256-char URLs; 200 is a practical UX cap.
   */
  WEBSITE_MAX: 200,
  /**
   * WHY: Stylist profile description shown to clients. Max 1000 chars (approx. 150-200
   * words) provides enough space for a meaningful bio without overwhelming the UI. Keeps
   * DB payload reasonable and prevents abuse of text storage.
   */
  DESCRIPTION_MAX: 1000,
  /**
   * WHY: Internal note field (per gallery record or client pairing). Max 500 chars keeps
   * notes concise. Smaller than DASHBOARD_NOTE_MAX because record-level notes are inline
   * annotations, not long-form content.
   */
  NOTE_MAX: 500,
  /**
   * WHY: Dashboard (stylist/client personal notes area) allows longer content than
   * per-record notes. Max 2000 chars (approx. 300-400 words) matches announcement and
   * log message caps — a consistent "medium-form text" limit across the platform.
   */
  DASHBOARD_NOTE_MAX: 2000,
  /**
   * WHY: Admin dashboard notes (internal scratchpad, append-only without prune). Max
   * 5000 chars (~750 words), consistent with CONTACT_MESSAGE_MAX / VALIDATION_MODERATION
   * .ADMIN_NOTE_MAX order of magnitude. Closes the storage-abuse gap where the only
   * boundary was the framework-level bodyParser (1 MB).
   *
   * DECISION: a SEPARATE scope from VALIDATION_MODERATION.ADMIN_NOTE_MAX (5000): that one caps
   * moderation.admin_note, this one the admin-dashboard scratchpad. Do not reuse the other constant
   * (different features, same value). admin-notes.operations.ts reads this one as its cap.
   */
  ADMIN_DASHBOARD_NOTE_MAX: 5000,
  /**
   * WHY: Color and trait names in admin panel. Min 1 char allows single-letter color
   * codes if needed. Max 100 chars fits admin UI without truncation. Consistent with
   * NAME_MAX to avoid disparate limits across similar text fields.
   */
  COLOR_NAME_MIN: 1,
  COLOR_NAME_MAX: 100,
  TRAIT_NAME_MIN: 1,
  TRAIT_NAME_MAX: 100,
  /**
   * WHY: Icon URLs for trait icons stored as HTTPS URLs. Max 500 chars covers CDN URLs
   * with path and signed parameters (e.g. Cloudinary or S3 presigned URLs). HTTPS-only
   * enforced via validateOptionalHttpsUrl to prevent XSS via javascript:/data: schemes.
   */
  ICON_URL_MAX: 500,
  /**
   * WHY: Cloudinary asset URLs come FROM THE CLIENT (the front gets them from the direct upload),
   * so without an upper bound a schema checking only the domain prefix accepts a 50,000-char
   * `public_id`. The cost is double: the row bloats, and every add runs two `contains` queries (the
   * asset ownership gate), a scan over a caller-controlled pattern. 1000 chars fits a URL with
   * folder, transformation chain and signature and cuts absurd values. The gallery and visit photos
   * share the value because they share the attack surface.
   */
  ASSET_URL_MAX: 1000,
  /**
   * WHY: Entity identifiers in the body (pair_id, stylist_account_id, client_user_id, photo_id) go
   * straight into a key lookup. Without an upper bound a 20,000-char string passed validation and
   * reached the DB only to find nothing: free work on demand. Real identifiers are cuid/uuid
   * (25-36 chars); 128 leaves room for prefixed formats.
   */
  ENTITY_ID_MAX: 128,
  /**
   * WHY: Cryptographic tokens (e.g. newsletter confirmation, unsubscribe links).
   * Min 16 chars = 128-bit entropy minimum — NIST SP 800-63B recommendation for
   * session tokens. Max 64 covers SHA-256 hex (64 chars) and similar digest outputs
   * without excessive DB storage. Tighter than misc.validation.ts unsubscribe cap (128)
   * which handles URL-embedded tokens that may include base64 padding.
   */
  TOKEN_MIN: 16,
  TOKEN_MAX: 64,
  /**
   * WHY: Announcement title shown as headline in the app UI. Max 200 chars fits a
   * two-line headline in typical card/banner layouts without overflow. Consistent with
   * standard push notification title length limits (iOS/Android: 65-65 chars visible,
   * but stored full length for web display).
   */
  ANNOUNCEMENT_TITLE_MAX: 200,
  /**
   * WHY: Announcement message body shown in-app notifications. Max 2000 chars matches
   * DASHBOARD_NOTE_MAX — a consistent "medium-form text" cap. Long enough for detailed
   * maintenance notices, short enough to avoid wall-of-text UX.
   */
  ANNOUNCEMENT_MESSAGE_MAX: 2000,
  /**
   * WHY: Contact form name and message. Name max 100 = consistent with NAME_MAX.
   * Message max 5000 chars allows detailed support requests (~750 words) without
   * enabling abuse of the contact endpoint as a file upload mechanism. Larger than
   * DASHBOARD_NOTE_MAX because contact messages are one-off submissions, not stored
   * user content subject to quota.
   */
  CONTACT_NAME_MAX: 100,
  CONTACT_MESSAGE_MAX: 5000,
  /**
   * WHY: Minimum meaningful contact message — 10 chars rejects trivial
   * submissions ("hi", "?") that carry no actionable content. Mirrors the
   * "minimum meaningful free-text" floor used for support messages.
   */
  CONTACT_MESSAGE_MIN: 10,
  /**
   * WHY: Email address max length = 254 chars, the RFC 5321 hard limit on the
   * forward-path (total addr-spec the SMTP transport accepts). Applied to stored
   * contact emails (e.g. client contact card) so the field cannot accept addresses
   * no mail server would route. Regex (VALIDATION_REGEX.EMAIL) validates shape;
   * this caps size to block multi-KB strings sneaking past the format check.
   */
  EMAIL_MAX: 254,
  /**
   * WHY: Search query and city filter in explore/gallery endpoints. Max 100 chars
   * prevents excessively long queries that could cause slow LIKE/full-text DB scans.
   * Consistent with NAME_MAX — no real search query needs more than 100 chars.
   */
  SEARCH_QUERY_MAX: 100,
  CITY_FILTER_MAX: 100,
  /**
   * WHY: Internal event log fields. Namespace max 200 covers dot-separated module paths
   * (e.g. "web-1.application.email.sendgrid.handler"). Message max 2000 = consistent
   * medium-form cap. Payload max 8000 chars (~8 KB) allows structured JSON context
   * (stack traces, request bodies) without enabling DB row bloat. User metadata max 5000
   * covers serialized user context objects. Environment max 50 covers common values
   * ("production", "staging", "development", "test") with room for custom env names.
   *
   * DECISION: LOG_PAYLOAD_MAX (8000) is aligned with MAX_PAYLOAD_LENGTH in
   * web-1/src/domain/admin/operations/admin-logs.operations.ts. The operation truncates past 8 KB;
   * matching the cap means an over-sized payload gets a clear 400 instead of silent truncation on write.
   * Operation-side truncation stays as defense in depth for ingestion paths that bypass this validator.
   */
  LOG_NAMESPACE_MAX: 200,
  LOG_MESSAGE_MAX: 2000,
  LOG_PAYLOAD_MAX: 8_000,
  LOG_USER_METADATA_MAX: 5000,
  LOG_ENVIRONMENT_MAX: 50,

  CONSENT_SOURCE_MAX: 50,
  /**
   * WHY: checkout `source` (funnel origin: 'onboarding'|'account-pay'|'pricing') is injected 1:1
   * into Stripe Checkout Session metadata. Stripe hard-limits a metadata value to 500 chars, so a
   * bound below that cap closes a self-DoS (a raw POST with an oversized string throws into an
   * opaque 500). 64 is enough for an enum source.
   */
  CHECKOUT_SOURCE_MAX: 64,
  /** Human-readable promotion code (`ANNA-7K2Q`). ASCII, one hyphen. */
  CHECKOUT_PROMO_MAX: 40,
  /**
   * WHY: Admin policy (regulamin/ToS/privacy) title + content stored unbounded in
   * Postgres `Policy.title String` / `Policy.content String @db.Text`. Free-text
   * written straight to DB by savePolicy_IO with no producer-side cap (sibling
   * saveNote_IO HAS one). Bound closes storage-abuse / row-bloat by a malicious or
   * compromised admin. TITLE is of the order of ANNOUNCEMENT_TITLE_MAX (a document name); CONTENT
   * 50k = a full terms of service (longer than the medium-form DASHBOARD_NOTE) with margin: a real
   * document is far below the cap, it only closes an adversarial mega-string.
   */
  POLICY_TITLE_MAX: 200,
  POLICY_CONTENT_MAX: 50_000,
  /**
   * WHY: Cloudflare Turnstile response token (`turnstile_token` on the public
   * contact form). Cloudflare documents the widget token as "up to 2048 characters"
   * (siteverify `response` param) — the cap is the vendor's own upper bound, NOT a
   * crypto-token length like TOKEN_MAX (64). Anything longer is adversarial input
   * (self-DoS / storage abuse), never a real widget token.
   */
  TURNSTILE_TOKEN_MAX: 2048,
} as const;

// ── Geolocation constraints ──
export const VALIDATION_GEO = {
  /**
   * WHY: WGS-84 geographic coordinate system standard bounds.
   * Latitude range −90° to +90° (South Pole to North Pole).
   * Longitude range −180° to +180° (antimeridian to antimeridian).
   * Any value outside these ranges is physically impossible and indicates a client bug
   * or spoofed input. Used in stylist location search endpoint.
   */
  LATITUDE_MIN: -90,
  LATITUDE_MAX: 90,
  LONGITUDE_MIN: -180,
  LONGITUDE_MAX: 180,
  /**
   * WHY: Maximum geosearch radius of 1000 km prevents runaway queries that would match
   * the entire country (Poland is ~650 km N-S). A 1000 km radius is functionally
   * equivalent to "national" search. Larger values add no UX value but increase DB
   * PostGIS/Haversine computation cost and expose the endpoint to DoS via expensive
   * geo-intersection queries.
   */
  RADIUS_KM_MAX: 1000,
} as const;

// ── Pagination constraints ──
export const VALIDATION_PAGINATION = {
  /**
   * WHY: Minimum page size of 1 — an empty page request is a client bug; reject it
   * to avoid empty DB queries. Maximum 100 caps response payload size and protects
   * against scrape-style enumeration (returning all records in one request). Both
   * endpoints and the frontend use this shared cap.
   */
  LIMIT_MIN: 1,
  LIMIT_MAX: 100,
  // Browse/explore endpoints (public stylists list, gallery feed) use tighter cap
  // to limit payload size and protect against scrape-style enumeration.
  LIMIT_MAX_BROWSE: 50,
  /**
   * WHY: Offset-based pagination starts at 0 (first record). Values below 0 are
   * semantically invalid and rejected to avoid confusing DB OFFSET behavior.
   * Page-based pagination starts at 1 (human-readable first page).
   */
  OFFSET_MIN: 0,
  PAGE_MIN: 1,
} as const;

// ── Bulk operation constraints ──
export const VALIDATION_BULK = {
  /**
   * WHY: Admin bulk operations (disable, enable, change plan, logout) accept up to
   * 100 user IDs per request. Cap prevents single requests from triggering
   * disproportionately large DB writes — 100 rows is manageable in one transaction
   * without timeouts. Matches VALIDATION_PAGINATION.LIMIT_MAX for consistency.
   */
  MAX_USER_IDS: 100,
  /**
   * WHY: Display order is a non-negative integer used for manual ordering of colors
   * and traits in admin panel. Minimum 0 allows zero-based ordering. Negative values
   * have no semantic meaning in ordered lists and are rejected.
   */
  MIN_DISPLAY_ORDER: 0,
} as const;

// ── Gallery array constraints ──
export const VALIDATION_GALLERY = {
  /**
   * WHY: Each gallery record can have up to 20 color tags and 20 style trait tags.
   * Cap prevents overly-tagged records that would be hard to use for filtering
   * (diminishing UX returns beyond ~5-10 tags) and limits the size of the join
   * table inserts per record. 20 is generous enough for highly specific styles
   * while blocking runaway tagging from buggy clients.
   */
  MAX_COLOR_IDS: 20,
  MAX_TRAIT_IDS: 20,

  /**
   * WHY (separate from the limits ABOVE): those cap the number of tags on ONE record at write
   * time; these cap the length of the FILTER array in a query, a different dimension (filtering by
   * more values than one photo can carry), so one constant cannot serve both.
   *
   * A DoS barrier, not UX polish. Filters expand into a separate condition per identifier, so
   * cost grows non-linearly: on the public, UNAUTHENTICATED `public/get-gallery-by-account` 83 ms
   * with no filters became 2.7 s at 150 and 7.0 s at 200 identifiers, so one cheap request holds a
   * pool connection for seven seconds and a few in parallel exhaust the pool; the request rate limit
   * does not stop that. 50 is the value `explore` already capped at.
   */
  MAX_FILTER_COLOR_IDS: 50,
  MAX_FILTER_TRAIT_IDS: 50,

  /**
   * WHY: the reorder command carries the FULL ordered list of the stylist's visible
   * pinned works. The pin gate caps that set at the plan limit (top plan: 50), so
   * 100 leaves headroom for a future plan without letting a buggy client send an
   * unbounded array into one UPDATE.
   */
  MAX_PINNED_REORDER_IDS: 100,
} as const;

// ── Support thread/message constraints ──
// SSOT for support form caps — mirrors server-side validation in
// .shared-kernel/policies/validation/support.validation.ts
export const SUPPORT_LENGTHS = {
  /**
   * WHY: Support ticket subject line. Min 3 chars prevents empty/trivially short
   * subjects ("hi", "ok") that give agents no context. Max 100 fits email subject
   * line conventions (RFC 2822 recommended subject length) and support panel UI.
   */
  SUBJECT_MIN: 3,
  SUBJECT_MAX: 100,
  /**
   * WHY: Support message min 10 chars filters out accidental one-word submissions
   * ("test", "hello") that require a follow-up. Max 2000 = medium-form cap consistent
   * with DASHBOARD_NOTE_MAX. Reply and internal note caps match message max for
   * consistency — agents and clients have the same character budget.
   */
  MESSAGE_MIN: 10,
  MESSAGE_MAX: 2000,
  REPLY_MAX: 2000,
  INTERNAL_NOTE_MAX: 2000,
} as const;

// ── Stylist<->client messenger ──
export const MESSAGING_LENGTHS = {
  /**
   * WHY: 1:1 chat, a single message may be short ("ok"), so MIN=1 (non-empty after trim).
   * MAX=2000 = parity with SUPPORT_LENGTHS.MESSAGE_MAX, enough for longer arrangements (date,
   * description of a design) without abuse.
   */
  CONTENT_MIN: 1,
  CONTENT_MAX: 2000,
} as const;

// ── Moderation/admin content constraints ──
// SSOT for moderation form caps used by moderation.validation.ts
export const VALIDATION_MODERATION = {
  /**
   * WHY: Moderation description (report reason) max 1000 = consistent with
   * DESCRIPTION_MAX. Enough for a thorough report explanation (~150 words) without
   * enabling abuse of the moderation form as a text dump.
   */
  DESCRIPTION_MAX: 1000,
  /**
   * WHY: Minimum meaningful report description — 10 chars blocks empty/trivial
   * abuse reports that give moderators nothing to act on.
   */
  DESCRIPTION_MIN: 10,
  /**
   * WHY: Admin internal notes on moderation actions. Max 5000 chars (consistent with
   * CONTACT_MESSAGE_MAX) allows detailed case notes for complex situations. Larger than
   * user-facing fields because admin notes are internal tooling, not user content.
   */
  ADMIN_NOTE_MAX: 5000,
  /**
   * WHY: Strike/ban reason shown to the affected user. Max 2000 = medium-form cap,
   * consistent with LOG_MESSAGE_MAX and ANNOUNCEMENT_MESSAGE_MAX. Long enough to
   * provide a clear, actionable explanation; short enough to stay readable.
   */
  STRIKE_REASON_MAX: 2000,
} as const;

// ── Social profile field constraints ──
// SSOT for social handle limits — mirrors frontend constants in
// main/src/UI/features/account/components/StylistProfileSection.tsx
export const VALIDATION_SOCIAL = {
  /**
   * WHY: Instagram's official maximum username length is 30 characters (per Instagram
   * Help Center and their own API validation). Matching their limit exactly avoids
   * accepting handles that Instagram itself would reject, preventing invalid links
   * on stylist public profiles.
   */
  INSTAGRAM_HANDLE_MAX: 30,
} as const;

/** True when a stored phone has a dialable number, not just separators. */
export const isValidPhoneNumber = (value: string): boolean => {
  if (!VALIDATION_REGEX.PHONE_FORMAT.test(value)) {
    return false;
  }
  const digits = value.replace(/\D/g, '');
  return (
    digits.length >= VALIDATION_REGEX.PHONE_MIN_DIGITS &&
    digits.length <= VALIDATION_REGEX.PHONE_MAX_DIGITS
  );
};

// ── Admin config value size caps ──
// DECISION: adminUpdateConfig value caps prevent DB bloat from adversarial or buggy admin payloads:
// scalars (string/number/boolean serialized as string) 1 KB, object/array payloads (stringified JSON)
// 32 KB, generous for structured configs and tight against multi-MB injection. Larger values return
// 400 before the DB write.
export const VALIDATION_CONFIG = {
  VALUE_PRIMITIVE_MAX: 1_024, // 1 KB — for scalar config values
  VALUE_OBJECT_MAX: 32_768, // 32 KB — for JSON object/array values
} as const;
