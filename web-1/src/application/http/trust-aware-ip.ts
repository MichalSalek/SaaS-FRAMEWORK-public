import type { IncomingHttpHeaders } from 'node:http';
import { ENV_VARS } from '@app/environment/environment.config';

/**
 * Trust-aware client-IP resolution.
 *
 * THREAT MODEL (root cause of the XFF-trust antipattern):
 * `X-Forwarded-For` is a comma-separated chain where each proxy APPENDS the
 * IP it received the connection from to the RIGHT. The LEFTMOST entry is
 * therefore fully attacker-controlled — a client can inject any value(s) it
 * wants, and a real reverse proxy will simply append the real hop to the
 * right, leaving the forged left entries intact. Keying rate-limit buckets or
 * view-dedup on the leftmost entry lets an attacker rotate a header to mint an
 * unlimited number of fresh buckets (bypass) or pin a victim's IP (poisoning).
 *
 * RESOLUTION STRATEGY (in priority order):
 *  1. Platform-trusted single-IP header — ONLY when the deployment is explicitly
 *     configured to sit behind that edge (env `TRUSTED_EDGE`). The edge
 *     OVERWRITES (does not append) this header, so a client cannot forge it
 *     end-to-end — BUT only if such an edge is actually in front. On a bare
 *     Render/Node deployment a client could send `cf-connecting-ip` itself, so
 *     this strategy is OFF by default and must be opted into per deployment:
 *       - `TRUSTED_EDGE=cloudflare` → trust `cf-connecting-ip`
 *       - `TRUSTED_EDGE=vercel`     → trust `x-vercel-forwarded-for`
 *  2. `x-forwarded-for` resolved by TRUSTED-PROXY DEPTH — ONLY when
 *     `TRUSTED_PROXY_DEPTH` is EXPLICITLY set. Take the hop the OUTERMOST trusted
 *     proxy observed, i.e. index `len - TRUSTED_PROXY_DEPTH` from the right.
 *     Entries LEFT of that boundary are untrusted client input, never selected.
 *  3. Unspoofable socket peer (`req.socket.remoteAddress`), passed in by the
 *     caller. This is the SECURE-BY-DEFAULT anchor used whenever the deployment
 *     is UNCONFIGURED (neither `TRUSTED_EDGE` nor `TRUSTED_PROXY_DEPTH` set):
 *     in that mode NO forwarding header is trusted at all, because without a
 *     declared trusted proxy chain EVERY XFF/x-real-ip hop (including the
 *     rightmost) is client-controllable — a bare front simply passes the
 *     client's XFF through verbatim. The socket peer is the only value an
 *     unauthenticated client cannot forge.
 *
 * CONFIG (security-critical — see `.env.example` + MAIN_DEPLOY_INSTRUCTION):
 *  - `TRUSTED_PROXY_DEPTH` (env): number of proxies that the deployment trusts
 *    to have appended hops to XFF. UNSET = no XFF hop is trusted (socket-peer
 *    anchor only). Set to the EXACT chain length only when a fixed chain of
 *    trusted proxies fronts the app (e.g. Cloudflare -> Render LB -> app == 2).
 *    Too high re-exposes the bypass (you start trusting client-supplied left
 *    entries); too low keys on a trusted proxy's own IP (clients share a bucket).
 *  - `TRUSTED_EDGE` (env, default unset = none): `cloudflare` | `vercel`. Set
 *    ONLY when the named edge genuinely fronts every request — otherwise leave
 *    unset so the spoofable platform headers are ignored.
 *
 * DECISION (nie usuwaj tego komentarza):
 * UNCONFIGURED = secure-by-default: trust NOTHING from headers, anchor on the
 * socket peer. Previously the resolver fell back to a hardcoded depth=1 and
 * trusted the RIGHTMOST XFF hop even with no proxy config — but the rightmost
 * hop is just as client-controllable as the leftmost whenever the front does
 * NOT overwrite/append XFF (proven: a bare Next.js / dev backend passes
 * client-supplied XFF through verbatim, so the "rightmost" hop is the attacker's
 * value). That relocated the spoof instead of eliminating it: rotating the
 * rightmost segment minted unlimited fresh rate-limit/dedup buckets. The fix:
 * an XFF hop is trusted ONLY when the operator EXPLICITLY declares the trusted
 * proxy depth (or names a trusted edge). With neither set, the only
 * non-spoofable source is the kernel-level socket peer, which the caller passes
 * in. Dev/unconfigured stays fully functional (socket peer is stable per client)
 * AND XFF-spoofing is closed (forged headers are ignored entirely).
 *
 * SECURITY NOTE: `x-real-ip` is intentionally NOT trusted as a primary source
 * here — it is a single-value header that a client can spoof just as easily as
 * the leftmost XFF when no proxy overwrites it. It is consulted only AFTER the
 * trusted strategies (and only while a trusted chain/edge is configured), never
 * in unconfigured mode.
 */

/**
 * Trusted-proxy depth used when `TRUSTED_PROXY_DEPTH` IS set but malformed
 * (e.g. `0`, `-3`, `abc`). A configured-but-invalid value falls back to a
 * single trusted hop rather than silently disabling XFF trust the operator
 * clearly intended to enable. UNSET (env absent) is a DIFFERENT, secure state
 * handled by `getTrustedProxyDepth()` returning null (no XFF trust at all).
 */
const FALLBACK_TRUSTED_PROXY_DEPTH = 1;

/**
 * Resolve the platform edge header name to trust, gated by `TRUSTED_EDGE`.
 * Returns null when no edge is configured (the safe default) — strategy #1 is
 * then skipped and resolution falls through to trusted-proxy-depth XFF.
 */
const getTrustedEdgeHeader = ():
  'cf-connecting-ip' | 'x-vercel-forwarded-for' | null => {
  const edge = ENV_VARS.TRUSTED_EDGE.trim().toLowerCase();
  if (edge === 'cloudflare') {
    return 'cf-connecting-ip';
  }
  if (edge === 'vercel') {
    return 'x-vercel-forwarded-for';
  }
  return null;
};

/**
 * Read & validate the trusted-proxy depth from the environment.
 *
 * Returns:
 *  - `null`  when `TRUSTED_PROXY_DEPTH` is UNSET/empty — the deployment has NOT
 *    declared a trusted proxy chain, so NO XFF hop may be trusted (the resolver
 *    then anchors on the unspoofable socket peer). This is the secure default.
 *  - a positive integer when the operator EXPLICITLY pinned the chain depth.
 *  - `FALLBACK_TRUSTED_PROXY_DEPTH` when the env IS present but malformed
 *    (intent to trust a chain is clear; the exact value is just unparsable).
 *
 * Read lazily on each call (not module-load) so tests / runtime config changes
 * are honored and so this helper never throws at import time.
 */
const getTrustedProxyDepth = (): number | null => {
  const raw = ENV_VARS.TRUSTED_PROXY_DEPTH.trim();
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return FALLBACK_TRUSTED_PROXY_DEPTH;
  }
  return parsed;
};

/** Normalize a raw header value (string | string[] | undefined) to a string or null. */
const firstHeaderValue = (
  value: string | string[] | undefined
): string | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return typeof value === 'string' ? value : null;
};

/**
 * Canonicalize a raw IP token into a single stable bucket/dedup key, so one
 * logical client never fragments across representation variants. Returns null
 * for empty input. Steps (order matters):
 *  1. trim whitespace.
 *  2. strip ONE surrounding pair of `[ ]` (bracketed IPv6, e.g. `[2001:db8::1]`
 *     or `[::1]:443`) and remember it was bracketed.
 *  3. strip a trailing `:port` when unambiguous:
 *       - bracketed source: a `:digits` suffix AFTER the `]` is the port.
 *       - bare IPv4 dotted-quad with exactly one `:` -> `a.b.c.d:port`.
 *     (A bare IPv6 has many `:` and no port without brackets, so it is left
 *     intact — stripping there would corrupt the address.)
 *  4. strip an IPv4-mapped IPv6 prefix (`::ffff:1.2.3.4` -> `1.2.3.4`).
 *  5. lowercase IPv6 (any remaining `:`) so `2001:DB8::1` == `2001:db8::1`.
 */
const normalizeIp = (raw: string | null | undefined): string | null => {
  if (!raw) {
    return null;
  }
  let ip = raw.trim();
  if (!ip) {
    return null;
  }

  // 2-3. Bracketed IPv6 (optionally with a port after the closing bracket).
  let wasBracketed = false;
  if (ip.startsWith('[')) {
    const close = ip.indexOf(']');
    if (close !== -1) {
      wasBracketed = true;
      // Drop a `:port` suffix after `]` (e.g. "[::1]:443" -> "::1"); ignore any
      // other trailing characters so the inner address is always recovered.
      ip = ip.slice(1, close);
    }
  }

  // 3 (cont). Bare IPv4 with a single colon -> dotted-quad + port. A bare IPv6
  // has >=2 colons and is left intact (it carries no port without brackets).
  if (!wasBracketed) {
    const firstColon = ip.indexOf(':');
    if (firstColon !== -1 && ip.indexOf(':', firstColon + 1) === -1) {
      ip = ip.slice(0, firstColon);
    }
  }

  // 4. IPv4-mapped IPv6 (e.g. "::ffff:1.2.3.4") -> "1.2.3.4".
  if (ip.toLowerCase().startsWith('::ffff:')) {
    ip = ip.slice('::ffff:'.length);
  }

  if (!ip) {
    return null;
  }

  // 5. Case-fold IPv6 (presence of ':' after de-bracketing) for a canonical key.
  return ip.includes(':') ? ip.toLowerCase() : ip;
};

/**
 * Extract the canonical client IP from a platform edge header value. Edge headers
 * (cf-connecting-ip / x-vercel-forwarded-for) normally carry a single IP, but
 * defensively take the FIRST comma-segment — the edge's reported client IP — in
 * case the platform forwards a chain. Only reached when TRUSTED_EDGE is set, so
 * this value originates from a trusted edge, not from raw client input.
 */
const normalizeEdgeIp = (raw: string | null): string | null =>
  normalizeIp(raw?.split(',')[0] ?? null);

/**
 * Pick the trusted hop from an `x-forwarded-for` chain using trusted-proxy depth.
 * Counts `depth` hops from the RIGHT (proxies append to the right). The entry at
 * the boundary is what the outermost trusted proxy observed; anything further
 * left is untrusted client input and is ignored.
 *
 * `depth` is always a positive integer here — callers invoke this ONLY after
 * confirming a trusted proxy chain is configured (depth !== null). It is never
 * reached in unconfigured (socket-anchor) mode.
 */
const pickTrustedXffHop = (
  xffRaw: string | null,
  depth: number
): string | null => {
  if (!xffRaw) {
    return null;
  }
  const hops = xffRaw
    .split(',')
    .map(h => h.trim())
    .filter(h => h.length > 0);
  if (hops.length === 0) {
    return null;
  }
  // index counted from the right: len - depth. Clamp to 0 so an under-length
  // chain (fewer hops than configured depth) degrades to the leftmost AVAILABLE
  // trusted entry rather than reading out of bounds. Never reads beyond the chain.
  const index = Math.max(0, hops.length - depth);
  return normalizeIp(hops[index]);
};

/**
 * Resolve a trusted IP from forwarding headers WHEN a trust config exists.
 * Shared core for both header shapes — operates on a tiny accessor so the Node
 * (`IncomingHttpHeaders`) and Fetch (`Headers`) callers reuse identical logic.
 *
 * Returns null when:
 *  - the deployment is UNCONFIGURED (no `TRUSTED_EDGE`, no `TRUSTED_PROXY_DEPTH`)
 *    → no forwarding header is trustworthy; the caller must anchor on the socket.
 *  - a trust config exists but none of the trusted headers are present.
 */
const resolveFromForwardingHeaders = (
  get: (name: string) => string | null
): string | null => {
  // 1. Platform edge header — ONLY when TRUSTED_EDGE names an edge that fronts us
  // (the edge OVERWRITES it, so it is not forgeable end-to-end). OFF by default.
  const edgeHeader = getTrustedEdgeHeader();
  if (edgeHeader) {
    const edgeIp = normalizeEdgeIp(get(edgeHeader));
    if (edgeIp) {
      return edgeIp;
    }
  }

  // 2. XFF resolved by trusted-proxy depth — ONLY when the operator EXPLICITLY
  // declared the chain depth. UNSET (depth === null) means no proxy chain is
  // trusted: skip XFF AND x-real-ip entirely so a forged header (any hop) is
  // never selected. The caller then anchors on the unspoofable socket peer.
  const depth = getTrustedProxyDepth();
  if (depth === null) {
    return null;
  }

  const xff = pickTrustedXffHop(get('x-forwarded-for'), depth);
  if (xff) {
    return xff;
  }

  // 3. Last-resort hint: x-real-ip. Spoofable when no proxy overwrites it, so it
  // ranks BELOW XFF and is only consulted while a trusted chain is configured
  // (kept for deployments whose proxy sets exclusively x-real-ip).
  return normalizeIp(get('x-real-ip'));
};

/**
 * Resolve a TRUST-AWARE client IP from Node request headers.
 *
 * @param headers              request headers.
 * @param socketRemoteAddress  the kernel-level peer (`req.socket.remoteAddress`).
 *   Pass it ALWAYS: it is the secure-by-default anchor used in unconfigured mode
 *   and the unspoofable fallback when no trusted header is present.
 *
 * Resolution: trusted edge / trusted-proxy-depth XFF (only when configured) →
 * else the socket peer. Returns null only when nothing at all is available.
 *
 * This is the single source of truth for IP-keyed security controls
 * (rate limiting, view-dedup, anti-enumeration throttles). Do NOT reintroduce
 * leftmost-XFF parsing or a hardcoded depth default — see the threat model and
 * the DECISION block at the top of this file.
 */
export const resolveTrustedClientIp = (
  headers: IncomingHttpHeaders,
  socketRemoteAddress?: string | null
): string | null =>
  resolveFromForwardingHeaders(name => firstHeaderValue(headers[name])) ??
  normalizeIp(socketRemoteAddress);

/**
 * Fetch API `Headers` variant (Better Auth hooks operate on `Headers`).
 *
 * @param socketRemoteAddress  optional peer for the secure-by-default anchor.
 *   Better Auth's Fetch context does not expose the raw socket, so this is
 *   usually omitted; in unconfigured mode the resolver then returns null and
 *   the caller's own fallback applies.
 */
export const resolveTrustedClientIpFromFetch = (
  headers: Headers,
  socketRemoteAddress?: string | null
): string | null =>
  resolveFromForwardingHeaders(name => headers.get(name)) ??
  normalizeIp(socketRemoteAddress);
