import { isPrivateNoteKey } from '@kernel/application/diagnostic-redaction';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
// Import from real sources, NOT the @app/interceptors barrel.
// The barrel re-exports email-lifecycle/janitor interceptors that import back
// recordAuditEvent_IO from THIS file → 27 circular deps. Direct imports cut it.
import { fillUserMetadataWithLocation } from '@domain/user/user.utils.api';
import { getUser_IO } from '@domain/user/operations/user-crud.operations';
import type {
  EventLog,
  Session,
  User,
} from '@kernel/models/db_models.generated.dto';
import type { UserMetadata } from '@kernel/models/db_models.manual.dto';
import { EVENT_LOG_POLICY } from '@kernel/policies/event_log.policy';
import { reportIssueBackend } from '@app/debugger/error-handler';
import type { PushEventLogToDB } from './event-log.client';
import { writeRawEventLog_IO } from './event-log.client';
import { isEmailKey } from '@app/debugger/pii-redaction';
import { getCurrentRequestImpersonatingAdminId } from '@app/http/request-context';

/**
 * Audit log PII redaction.
 *
 * Default: returns ONLY allowed keys. Use to prevent PII bloat in event_log table.
 *
 * Usage:
 *   const safePayload = redactAuditPayload(body, ['gallery_record_id', 'reason']);
 *
 * For UI/operation context (NOT direct PII): pass ['feature_name', 'plan_tier', etc].
 */
export const redactAuditPayload = <T extends Record<string, unknown>>(
  body: T,
  allowedKeys: readonly (keyof T)[]
): Partial<T> => {
  const safe: Partial<T> = {};
  for (const key of allowedKeys) {
    if (key in body) {
      safe[key] = body[key];
    }
  }
  return safe;
};

// DECISION: defense-in-depth deny-list. The MAIN PII control is the allowlist
// (redactAuditPayload) applied by the caller; this is the last line: if a handler forgets it
// (e.g. `requestBody: body` raw), known PII keys are still stripped from requestBody/responseBody
// before the write (EventLog is kept indefinitely). Shallow (top-level): request bodies carry PII
// at the first level, deeper nesting is a call-site redaction bug. A drop logs a warn so a missing
// redact is visible. No call site allowlists these keys, so the deny never collides with an
// intentional allowlist.
// Address-carrying keys come from `pii-redaction.ts` instead of a second parallel list: the lists
// had diverged, and `writeRawEventLog_IO` (used by the magic-link adapter and the mail transport
// for `to`/`identifier`) leaked addresses through the second writer. The mechanism stays
// different on purpose: here the key is DELETED, in the logger it is redacted to the domain. The
// address family is decided by the `isEmailKey` predicate (`*mail(s)` pattern), not a name list
// (which let `userEmail` / `reporterEmail` through both paths), and compared on the NORMALISED
// key because raw request bodies come from outside and do not follow our naming (`Email`,
// `NEW_EMAIL`, `Notes`).
const PII_DENY_NAMES = [
  'phone',
  'contact_phone',
  'address_street',
  'address_postal_code',
  'name',
  'display_name',
  'first_name',
  'last_name',
  'description',
  'content',
] as const;

/** Separatory znikaja po OBU stronach porownania — inaczej `firstName` przechodzil,
 *  a `first_name` nie, choc to ten sam fakt. Surowe ciala zadan nie maja obowiazku
 *  trzymac sie naszej konwencji nazw, a to jest ostatnia linia obrony wlasnie przy nich. */
const normalizeKey = (key: string): string =>
  key.toLowerCase().replace(/[_\-.]/g, '');

const PII_DENY_KEYS = new Set<string>(PII_DENY_NAMES.map(normalizeKey));

const isPiiKey = (key: string): boolean =>
  isEmailKey(key) ||
  isPrivateNoteKey(key) ||
  PII_DENY_KEYS.has(normalizeKey(key));

/**
 * DECISION: a PII key is deleted only when its value CAN carry personal data, so booleans pass.
 * `has_email: true` in `client/update-contact` exists precisely to record that an address was
 * given instead of the address; deleting it removes the only signal and adds a false "dropped PII
 * key" warning on every write (same principle as `redactEmailValue`: `recipient: 42` is a legal
 * non-address use). Booleans ONLY: numbers are not safe (`{"phone": 48123456789}` in a raw body
 * is real personal data, and raw bodies are why this layer exists). Objects and arrays are still
 * deleted: they can hide an address at any depth.
 */
const valueCanCarryPii = (value: unknown): boolean =>
  typeof value !== 'boolean';

const stripPiiDefenseInDepth = <T extends object>(
  body: T,
  context: string
): T => {
  let dropped: string[] | null = null;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (isPiiKey(key) && valueCanCarryPii(value)) {
      (dropped ??= []).push(key);
      continue;
    }
    safe[key] = value;
  }
  if (dropped) {
    reportIssueBackend({
      namespace: 'recordAuditEvent_IO',
      message: `Defense-in-depth: dropped PII key(s) [${dropped.join(', ')}] from ${context} — call site should use redactAuditPayload`,
      payload: null,
      mode: 'warn',
    });
  }
  return safe as T;
};

export type AuditEventInput = {
  eventName: EVENT_INFO_TYPE;
  user?:
    | (Partial<Pick<User, 'id' | 'email'>> & Partial<Pick<Session, 'userId'>>)
    | null;
  requestBody?: object;
  responseBody?: object | null;
  metadata?: UserMetadata;
};
export const recordAuditEvent_IO = async (
  props: AuditEventInput
): Promise<EventLog | undefined> => {
  const { eventName, user, requestBody, responseBody, metadata } = props;

  try {
    if (
      !EVENT_LOG_POLICY.utils.GET_PERMISSION_APPROVAL_TO_PUSH_EVENT_LOG(
        eventName
      )
    ) {
      return undefined;
    }

    const meta: Partial<PushEventLogToDB['meta']> = {};
    const payload: PushEventLogToDB['eventPayloadToStringify'] = {};

    // Find id in passed user:
    // IDM migration: IDs are now strings (cuid), check for string type
    //
    if (user && 'id' in user && typeof user.id === 'string') {
      meta.created_by_user_id = user.id;
    } else if (user && 'userId' in user && typeof user.userId === 'string') {
      meta.created_by_user_id = user.userId;

      // Try to find id, maybe by email:
      //
    } else if (user && 'email' in user && typeof user.email === 'string') {
      const fetchedUser = await getUser_IO({ props: { email: user.email } });
      if (typeof fetchedUser?.id === 'string') {
        meta.created_by_user_id = fetchedUser.id;
      }
    }

    // Inside an impersonated session the row keeps the user as subject but names
    // the admin who actually acted (null for the user's own session).
    const impersonatingAdminId = await getCurrentRequestImpersonatingAdminId();
    if (impersonatingAdminId) {
      meta.impersonated_by_admin_id = impersonatingAdminId;
    }

    // Add an extra data responseBody to event log when exists:
    //
    const shouldPersistResponseBodyInEvent = Boolean(responseBody);
    if (shouldPersistResponseBodyInEvent) {
      payload.responseBody = responseBody;
    }

    // Get metadata:
    //
    const userMetadata = await fillUserMetadataWithLocation(metadata);

    const eventLogType =
      EVENT_LOG_POLICY.utils.GET_EVENT_LOG_TYPE_FOR_EVENT_LOG(eventName);
    if (!eventLogType) {
      return undefined;
    }

    const safeUser = meta.created_by_user_id
      ? { id: meta.created_by_user_id }
      : undefined;

    return await writeRawEventLog_IO({
      eventLogType,
      eventName,
      meta: { ...meta, ...userMetadata },
      eventPayloadToStringify: {
        requestBody: requestBody
          ? stripPiiDefenseInDepth(requestBody, 'requestBody')
          : requestBody,
        responseBody: responseBody
          ? stripPiiDefenseInDepth(responseBody, 'responseBody')
          : responseBody,
        user: safeUser,
      },
    });
  } catch (e) {
    reportIssueBackend({
      namespace: 'recordAuditEvent_IO',
      message: 'error',
      payload: e,
      mode: 'error',
    });
    return undefined;
  }
};
