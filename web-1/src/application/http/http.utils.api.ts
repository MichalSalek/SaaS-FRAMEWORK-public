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

// Identity pass-through, not a runtime validator: `HTTPStatus` is a union of literals, so the
// value is already narrowed at the call site. It exists as the one seam to `res.status(...)`
// (a single place to add a clamp or log later).
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

  // DECISION: client_ip is derived SERVER-SIDE from the trust-aware resolver, not from the
  // client-supplied `user-metadata` header (narrowUserMetadata accepts any string) and not from
  // request_ip.getClientIp (leftmost X-Forwarded-For). Both were spoofable, letting an
  // unauthenticated caller forge the view-dedup key (profile-view-dedup keys on client_ip) and
  // inflate any stylist's view_count; geolocation enrichment also needs the real IP.
  //
  // DECISION: `req.socket.remoteAddress` MUST be passed as the secure-by-default anchor
  // (resolveTrustedClientIp docstring: "Pass it ALWAYS"). With TRUSTED_PROXY_DEPTH/TRUSTED_EDGE
  // unset the resolver trusts NO forwarding header, so without the socket it returns null, and a
  // null client_ip silently disabled the whole view-dedup guard. Inert in configured deployments
  // (the trusted header IP is selected first); only one caller exists (request.middleware.ts).
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
