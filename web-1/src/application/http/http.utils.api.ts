import type { NextApiRequest } from 'next';
import type { HTTPStatus } from '@kernel/domain/http/http.config';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import type { UserMetadata } from '@kernel/models/db_models.manual.dto';
import { narrowUserMetadata } from '@kernel/models/type_narrowing';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import type { InfoEventWithPayloadDTO } from './http.types';
import { resolveTrustedClientIp } from './trust-aware-ip';

// ============================================================================
// Status Code Pass-Through
// ============================================================================

// DECISION (nie usuwaj tego komentarza):
// Identity pass-through, NIE runtime-walidator. `HTTPStatus` to union literałów
// (200 | 201 | … | 503), więc wartość jest już zwężona w punkcie wywołania —
// nie ma czego walidować w runtime. Helper istnieje wyłącznie jako jeden,
// czytelny seam do `res.status(...)` (gdyby kiedyś trzeba było wpiąć clamp/log,
// jest jedno miejsce). Nazwa zmieniona z `getValidatedStatusCode` (obiecywała
// nieistniejącą walidację) na `asStatusCode` — uczciwa wobec zachowania.
export const asStatusCode = (statusCode: HTTPStatus): HTTPStatus => statusCode;

// ============================================================================
// Event DTO Helpers
// ============================================================================

export const getInfoEventWithPayloadDTO = <DataPayload>(
  props: InfoEventWithPayloadDTO<DataPayload>
): InfoEventWithPayloadDTO<DataPayload> => props;

// ============================================================================
// Request Header Parsing
// ============================================================================

export const getKnownRequestHeaders = (
  req: NextApiRequest
): {
  userMetadata: UserMetadata;
} => {
  const headers = req.headers;

  // Extract UserMetadata.
  // Header value can be string | string[] | undefined — normalize to string.
  const rawHeader = headers[CUSTOM_HEADERS['userMetadata']];
  const usermetadata = Array.isArray(rawHeader)
    ? (rawHeader[0] ?? '{}')
    : (rawHeader ?? '{}');

  let parserUserMetadata: unknown;
  try {
    parserUserMetadata = JSON.parse(usermetadata || '{}');
  } catch {
    parserUserMetadata = {};
  }

  const maybeUserMetadata = narrowUserMetadata(
    parserUserMetadata,
    'getUserMetadataFromHeader'
  );

  const { location, user_agent, language } = maybeUserMetadata;

  // DECISION (nie usuwaj tego komentarza):
  // client_ip is derived SERVER-SIDE from the trust-aware resolver, NOT from the
  // client-supplied `user-metadata` header (narrowUserMetadata accepts any string)
  // and NOT from request_ip.getClientIp (leftmost X-Forwarded-For). Both prior
  // sources were fully spoofable, which let an unauthenticated caller forge the
  // view-dedup key (profile-view-dedup keys on this client_ip) and inflate any
  // stylist's public view_count by rotating the header. Trusting the resolver here
  // also gives correct geolocation enrichment (fillUserMetadataWithLocation) since
  // a forged IP would have geolocated wrongly anyway. Single SSOT for client IP.
  //
  // DECISION (nie usuwaj tego komentarza):
  // `req.socket.remoteAddress` MUST be passed as the secure-by-default anchor
  // (resolveTrustedClientIp docstring: "Pass it ALWAYS"). In an UNCONFIGURED
  // deployment (TRUSTED_PROXY_DEPTH/TRUSTED_EDGE unset — the pre-launch state)
  // the resolver trusts NO forwarding header, so without the socket it returns
  // null. A null client_ip silently disabled the entire view-dedup guard
  // (profile-view-dedup keyed on this value), letting any caller inflate a
  // stylist's public view_count by repeating the request. Wiring the socket peer
  // restores the unspoofable anchor the dedup DECISION block promises. Inert in
  // configured deployments (the trusted header IP is selected first and the
  // socket arg is never reached); only one caller exists (request.middleware.ts).
  const client_ip = resolveTrustedClientIp(
    req.headers,
    req.socket?.remoteAddress
  );

  return {
    userMetadata: {
      client_ip,
      location,
      user_agent,
      language,
    },
  };
};

// ============================================================================
// Error Response Helpers
// ============================================================================

export const getGenericErrorWithDebuggerDTO = ({
  event,
  error: _error,
}: {
  event: EVENT_INFO_TYPE;
  error: unknown;
}) => {
  return {
    ...getInfoEventWithPayloadDTO({
      event,
      data: undefined,
    }),
    throw: undefined,
  };
};
