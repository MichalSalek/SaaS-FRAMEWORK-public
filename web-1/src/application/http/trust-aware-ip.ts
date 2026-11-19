import type { IncomingHttpHeaders } from 'node:http';
import { isIP } from 'node:net';
import { ENV_VARS } from '@app/environment/environment.config';
import { reportIssueBackend } from '@app/debugger/error-handler';

/**
 * Trust-aware client IP. X-Forwarded-For appends to the right, so the leftmost entries
 * are attacker-controlled and must not key rate limits or view dedup.
 * Order: a platform single-IP header only when TRUSTED_EDGE matches and its proof
 * header is present; else x-forwarded-for at len - TRUSTED_PROXY_DEPTH from the right,
 * only when that env is set (too high reopens spoofing, too low shares a proxy bucket);
 * else the socket peer.
 */

/**
 * DECISION: UNCONFIGURED = trust NOTHING from headers, anchor on the socket peer. Without a
 * declared proxy chain every XFF hop, the rightmost included, is client-controllable (a bare
 * front passes client XFF through verbatim), so a hardcoded depth=1 only relocated the spoof.
 * Dev/unconfigured stays functional because the peer is stable per client.
 *
 * `x-real-ip` is never a primary source: a client spoofs it as easily as the leftmost XFF. It
 * is consulted only after the trusted strategies and only while a trusted chain/edge is set.
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
 * A platform edge the deployment declared in `TRUSTED_EDGE`: the single-IP header it overwrites and
 * the header that proves the request actually passed through it.
 */
type TrustedEdge = {
  readonly name: 'cloudflare' | 'vercel';
  readonly ipHeader: 'cf-connecting-ip' | 'x-vercel-forwarded-for';
  readonly proofHeader: 'cf-ray' | 'x-vercel-id';
  readonly proofFormat: RegExp;
};

const TRUSTED_EDGES: Readonly<Record<TrustedEdge['name'], TrustedEdge>> = {
  // cf-ray: 16 hex digits, a dash and the colo code (e.g. `a4eb72230936512f-WAW`).
  cloudflare: {
    name: 'cloudflare',
    ipHeader: 'cf-connecting-ip',
    proofHeader: 'cf-ray',
    proofFormat: /^[0-9a-f]{16}-[A-Z0-9]{3,4}$/i,
  },
  // x-vercel-id: one or more `region::` segments followed by the request id.
  vercel: {
    name: 'vercel',
    ipHeader: 'x-vercel-forwarded-for',
    proofHeader: 'x-vercel-id',
    proofFormat: /^[a-z0-9]+(::[a-z0-9-]+)+$/i,
  },
};

/**
 * Resolve the platform edge to trust, gated by `TRUSTED_EDGE`.
 * Returns null when no edge is configured (the safe default) — strategy #1 is
 * then skipped and resolution falls through to trusted-proxy-depth XFF.
 */
const getTrustedEdge = (): TrustedEdge | null => {
  const edge = ENV_VARS.TRUSTED_EDGE.trim().toLowerCase();
  if (edge === 'cloudflare' || edge === 'vercel') {
    return TRUSTED_EDGES[edge];
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
 * `normalizeIp` plus a syntax check: only a real IPv4/IPv6 literal may become a bucket key. A hop
 * such as `unknown`, `garbage` or an empty segment is not an identity; it would let any value mint
 * a bucket of its own.
 */
const canonicalIp = (raw: string | null | undefined): string | null => {
  const ip = normalizeIp(raw);
  return ip !== null && isIP(ip) !== 0 ? ip : null;
};

/**
 * Extract the canonical client IP from a platform edge header value. Edge headers
 * (cf-connecting-ip / x-vercel-forwarded-for) normally carry a single IP, but
 * defensively take the FIRST comma-segment — the edge's reported client IP — in
 * case the platform forwards a chain. Only reached when TRUSTED_EDGE is set, so
 * this value originates from a trusted edge, not from raw client input.
 */
const normalizeEdgeIp = (raw: string | null): string | null =>
  canonicalIp(raw?.split(',')[0] ?? null);

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
  return canonicalIp(hops[index]);
};

/**
 * DECISION: the edge IP header is trusted only when the request also carries the edge's proof
 * header (`cf-ray` / `x-vercel-id`) in its real format, never because the IP header merely exists.
 * Measured on production 2026-10-22: Cloudflare fronts BOTH api.example.com (our zone) and the
 * raw web-1-*.onrender.com host (Render's own edge), and it answers 403 to any client that sends
 * its own `cf-connecting-ip`, so a forged value cannot reach the app through either hostname; a
 * request without the proof did not pass the edge and falls back to the XFF depth / socket peer.
 * Removing the proof check re-opens the forged-header path the moment any non-edge route to the
 * origin appears.
 */
const hasEdgeProof = (
  get: (name: string) => string | null,
  edge: TrustedEdge
): boolean => {
  const proof = get(edge.proofHeader)?.trim() ?? '';
  return proof.length > 0 && edge.proofFormat.test(proof);
};

/** Validate the configured edge's proof and IP without returning the client IP. */
export const hasTrustedEdgeHeaders = (
  headers: IncomingHttpHeaders,
  expected: TrustedEdge['name']
): boolean => {
  const edge = getTrustedEdge();
  if (edge === null || edge.name !== expected) {
    return false;
  }
  const get = (name: string): string | null => {
    const value = headers[name];
    return typeof value === 'string' ? value : null;
  };
  return (
    hasEdgeProof(get, edge) && normalizeEdgeIp(get(edge.ipHeader)) !== null
  );
};

/** Shape of one request's forwarding headers, with no address in it (safe to log). */
type ForwardingShape = {
  edge: TrustedEdge['name'];
  edgeProof: boolean;
  edgeIp: 'absent' | 'invalid' | 'v4' | 'v6';
  xffHops: number;
  edgeIpInXff: boolean;
  xRealIp: boolean;
};

const describeForwardingShape = (
  get: (name: string) => string | null,
  edge: TrustedEdge
): ForwardingShape => {
  const rawEdgeIp = get(edge.ipHeader);
  const edgeIp = normalizeEdgeIp(rawEdgeIp);
  const xffHops = (get('x-forwarded-for') ?? '')
    .split(',')
    .map(hop => canonicalIp(hop))
    .filter((hop): hop is string => hop !== null);
  return {
    edge: edge.name,
    edgeProof: hasEdgeProof(get, edge),
    edgeIp:
      rawEdgeIp === null || rawEdgeIp.trim() === ''
        ? 'absent'
        : edgeIp === null
          ? 'invalid'
          : isIP(edgeIp) === 4
            ? 'v4'
            : 'v6',
    xffHops: xffHops.length,
    edgeIpInXff: edgeIp !== null && xffHops.includes(edgeIp),
    xRealIp: (get('x-real-ip') ?? '').trim() !== '',
  };
};

let forwardingShapeNoted = false;
let missingProofNoted = false;

/**
 * Once per process: report the forwarding-header shape of the first request (counts and booleans
 * only, never an address), and separately the first request that arrived WITHOUT the edge proof.
 * This is the live probe of the trust chain behind the edge; it costs one log row per process.
 */
const noteForwardingShapeOnce = (
  get: (name: string) => string | null,
  edge: TrustedEdge
): void => {
  if (forwardingShapeNoted && missingProofNoted) {
    return;
  }
  const shape = describeForwardingShape(get, edge);
  if (!forwardingShapeNoted) {
    forwardingShapeNoted = true;
    reportIssueBackend({
      namespace: 'TRUSTED_IP_SHAPE',
      message: 'Forwarding header shape of the first request behind the edge',
      payload: shape,
      mode: 'info',
    });
  }
  if (!shape.edgeProof && !missingProofNoted) {
    missingProofNoted = true;
    reportIssueBackend({
      namespace: 'TRUSTED_IP_SHAPE',
      message:
        'A request reached the app without the trusted edge proof header; its edge IP header was ignored',
      payload: shape,
      // info, not warn: the platform's own health probe reaches the container without the edge.
      mode: 'info',
    });
  }
};

/** Test seam: forget the once-per-process notes. */
export const resetForwardingShapeNotesForTests = (): void => {
  forwardingShapeNoted = false;
  missingProofNoted = false;
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
  // 1. Platform edge header — ONLY when TRUSTED_EDGE names an edge that fronts us AND this request
  // carries the edge's own proof header. OFF by default.
  const edge = getTrustedEdge();
  if (edge) {
    noteForwardingShapeOnce(get, edge);
    if (hasEdgeProof(get, edge)) {
      const edgeIp = normalizeEdgeIp(get(edge.ipHeader));
      if (edgeIp) {
        return edgeIp;
      }
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
  return canonicalIp(get('x-real-ip'));
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
 * Single source of truth for IP-keyed security controls (rate limiting, view-dedup,
 * anti-enumeration throttles). Leftmost-XFF parsing or a hardcoded depth default reopens the
 * bypass; see the DECISION block at the top of this file.
 */
export const resolveTrustedClientIp = (
  headers: IncomingHttpHeaders,
  socketRemoteAddress?: string | null
): string | null =>
  resolveFromForwardingHeaders(name => firstHeaderValue(headers[name])) ??
  canonicalIp(socketRemoteAddress);

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
  canonicalIp(socketRemoteAddress);

/** Expand an IPv6 literal into its eight 16-bit groups, or null when it is not one. */
const expandIpv6 = (ip: string): number[] | null => {
  let text = ip.split('%')[0] ?? '';
  // An embedded IPv4 tail (`64:ff9b::1.2.3.4`) becomes two groups.
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const octets = tail.split('.').map(part => Number.parseInt(part, 10));
    if (octets.length !== 4 || octets.some(o => !(o >= 0 && o <= 255))) {
      return null;
    }
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) {
    return null;
  }
  const parse = (part: string | undefined): number[] =>
    part ? part.split(':').map(group => Number.parseInt(group, 16)) : [];
  const head = parse(halves[0]);
  const rest = parse(halves[1]);
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) {
    return null;
  }
  const groups = [...head, ...Array<number>(missing).fill(0), ...rest];
  return groups.every(g => Number.isInteger(g) && g >= 0 && g <= 0xffff)
    ? groups
    : null;
};

/**
 * Bucket identity for an IP-keyed LIMIT: an IPv4 address as is, an IPv6 address collapsed to its
 * /64 (written `a:b:c:d::/64`).
 *
 * DECISION: one IPv6 subscriber usually owns a whole /64 and can rotate through 2^64 addresses, so
 * keying limits on the full address gives every request a fresh bucket. Better Auth collapses to
 * /64 by default (`advanced.ipAddress.ipv6Subnet`); the app limiter and the magic-link throttle use
 * this helper so all three layers agree. Only for limit keys: logs, sessions and Turnstile's
 * `remoteip` keep the full address.
 */
export const toRateLimitIpKey = (ip: string): string => {
  if (isIP(ip) !== 6) {
    return ip;
  }
  const groups = expandIpv6(ip);
  if (groups === null) {
    return ip;
  }
  return `${groups
    .slice(0, 4)
    .map(g => g.toString(16))
    .join(':')}::/64`;
};
