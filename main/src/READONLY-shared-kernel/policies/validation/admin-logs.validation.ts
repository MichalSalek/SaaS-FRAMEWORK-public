import { z } from 'zod';
import { TIMELINE_EVENT_TYPES } from '../../domain/admin/admin.config';
import {
  LOG_APPLICATIONS,
  LOG_ENVIRONMENTS,
  LOG_ISSUE_NOTE_MAX_LENGTH,
  LOG_ISSUE_STATUSES,
  LOG_STREAM_MAX_TAKE,
} from '../../domain/admin/log-triage.config';
import { SEND_LOG_TYPES } from '../../domain/admin/send-log.config';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import type { ADMIN_DTO_API_V1 } from '../../models/admin/admin.dto';
import {
  VALIDATION_LENGTHS,
  VALIDATION_PAGINATION,
} from '../validation.config';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

const V = VALIDATION_MESSAGES;

// ── adminSendLog ──────────────────────────────────────────────────────────────
//
// DECISION (nie usuwaj tego komentarza):
// adminSendLog ma DWA schematy (a NIE jeden jak reszta domeny), bo splata dwa
// wymagania, których jeden schemat nie pogodzi:
//   1) RUNTIME: oryginał akumuluje KAŻDY błąd pola do JEDNEGO bucketa `__general`
//      (zero kluczy per-pole) — to charakteryzowane (admin-logs.validation.test.ts
//      §"error surfaces"): `rejected(r, '__general')` jest pinowane dla non-object
//      i over-max environment. Aby `zodValidate` skierował błąd na `__general`, issue
//      MUSI mieć PUSTĄ ścieżkę (`path: []` → `issue.path.length === 0` → `__general`).
//      Typowane pola (`z.string()`) emitowałyby błędy na ścieżkę `['environment']`
//      (slot pola, NIE `__general`). Dlatego runtime używa permisywnych pól
//      (`z.unknown().optional()` — nigdy nie odrzucają same z siebie) + całość logiki
//      w `.superRefine` emitującym `path: []`. To 1:1 odwzorowuje routing oryginału.
//   2) BINDING: `z.infer` permisywnego runtime'u = `unknown` per pole → NIE związałby
//      się z REQUEST DTO. Dlatego osobny `adminSendLogBindingSchema` (typowany 1:1 do
//      DTO) służy WYŁĄCZNIE świadkowi `SchemaMatchesDto` (anti-drift) — nie jest
//      uruchamiany na żadnym wejściu. Runtime i binding pilnują się nawzajem: lista
//      pól w obu MUSI być ta sama (drift łapie albo test charakteryzacyjny, albo
//      kompilacja świadka).
const sendLogRuntimeSchema = z
  .object({
    environment: z.unknown().optional(),
    namespace: z.unknown().optional(),
    type: z.unknown().optional(),
    message: z.unknown().optional(),
    payload: z.unknown().optional(),
    user_id: z.unknown().optional(),
    user_metadata: z.unknown().optional(),
    client_url: z.unknown().optional(),
  })
  .superRefine((d, ctx) => {
    // Each check mirrors the original condition 1:1; every issue routes to `__general`
    // via the empty path. i18n key per condition = the exact key the original emitted.
    if (
      typeof d.environment !== 'string' ||
      d.environment.length === 0 ||
      d.environment.length > VALIDATION_LENGTHS.LOG_ENVIRONMENT_MAX
    ) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: V.sendLog.environmentRequired,
      });
    }
    if (
      typeof d.namespace !== 'string' ||
      d.namespace.length === 0 ||
      d.namespace.length > VALIDATION_LENGTHS.LOG_NAMESPACE_MAX
    ) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: V.sendLog.namespaceRequired,
      });
    }
    // SECURITY: type is an allowlist (SEND_LOG_TYPES) — case-sensitive, empty rejected.
    if (
      typeof d.type !== 'string' ||
      d.type.length === 0 ||
      !(SEND_LOG_TYPES as readonly string[]).includes(d.type)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: V.sendLog.typeRequired,
      });
    }
    if (
      typeof d.message !== 'string' ||
      d.message.length === 0 ||
      d.message.length > VALIDATION_LENGTHS.LOG_MESSAGE_MAX
    ) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: V.sendLog.messageRequired,
      });
    }
    // payload: must be a string, but EMPTY string is accepted (no length===0 check);
    // only over-max is rejected. Characterized "SURPRISE" — preserved 1:1.
    if (
      typeof d.payload !== 'string' ||
      d.payload.length > VALIDATION_LENGTHS.LOG_PAYLOAD_MAX
    ) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: V.sendLog.payloadRequired,
      });
    }
    // user_metadata: same "string-but-empty-ok, only over-max rejected" rule.
    if (
      typeof d.user_metadata !== 'string' ||
      d.user_metadata.length > VALIDATION_LENGTHS.LOG_USER_METADATA_MAX
    ) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: V.sendLog.userMetadataRequired,
      });
    }
    // user_id is in the REQUEST DTO but the original NEVER validated it — preserved
    // (no check here). It only exists as a `.shape` slot / binding field.
  });

// Typed witness-only schema (NOT executed) — see DECISION above. z.infer == SendLogRequest.
const sendLogBindingSchema = z.object({
  environment: z.string(),
  namespace: z.string(),
  type: z.string(),
  message: z.string(),
  payload: z.string(),
  user_id: z.string().nullable(),
  user_metadata: z.string(),
  client_url: z.string().optional(),
});

// ── adminGetUserTimeline ──────────────────────────────────────────────────────
//
// DECISION (nie usuwaj tego komentarza):
// adminGetUserTimeline również ma DWA schematy. Powód jest INNY niż w sendLog:
//   - RUNTIME jest LAŹNIEJSZY niż DTO na page/limit/event_type. Oryginał waliduje te
//     pola TYLKO gdy `!== undefined && !== null` — `null` jest CHARAKTERYZOWANY jako
//     „nie podano" (akceptowany, test §"null page/limit/event_type ... skipped").
//     DTO obiecuje `page?: number` (BEZ null). Typowany `z.number().nullable()`
//     związałby się jako `number | null` → drift z DTO; bez `.nullable()` odrzuciłby
//     `null` → złamałby test. Nie da się ZACIEŚNIĆ (test pinuje akceptację null).
//   - Dodatkowo i18n-precedence: string-na-page → `pageMustBeNumber`, liczba-poza-zakresem
//     / nie-integer → `pageMinOne`. `z.union([z.number()..., z.null()])` emitowałby
//     domyślny komunikat zod („Invalid input") dla string-input → LEAK i zła precedencja.
//   Stąd: permisywne pola (`z.unknown().optional()`) + `.superRefine` z dokładną
//   precedencją i kluczami i18n na ścieżce pola; osobny typowany schemat-świadek dla
//   bindingu. user_id TEŻ jest walidowany w `.superRefine` (nie jako twarde pole bazowe):
//   gdyby był `z.string().min(1)`, jego błąd zawalałby base-parse obiektu i zod POMIJAŁBY
//   `.superRefine` → page/limit/event_type nie byłyby walidowane przy złym user_id (ręczny
//   walidator sprawdzał każde pole NIEZALEŻNIE). Walidacja w refine trzyma tę niezależność.
const getUserTimelineRuntimeSchema = z
  .object({
    user_id: z.unknown().optional(),
    page: z.unknown().optional(),
    limit: z.unknown().optional(),
    event_type: z.unknown().optional(),
  })
  .superRefine((d, ctx) => {
    // user_id: required — missing/empty/non-string → invalidId on the user_id slot.
    if (typeof d.user_id !== 'string' || d.user_id.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['user_id'],
        message: V.user.invalidId,
      });
    }
    // page: optional — validated only when present (undefined AND null both skipped).
    if (d.page !== undefined && d.page !== null) {
      if (typeof d.page !== 'number') {
        ctx.addIssue({
          code: 'custom',
          path: ['page'],
          message: V.timeline.pageMustBeNumber,
        });
      } else if (
        d.page < VALIDATION_PAGINATION.PAGE_MIN ||
        !Number.isInteger(d.page)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['page'],
          message: V.timeline.pageMinOne,
        });
      }
    }
    // limit: optional — validated only when present; range + integer under one key.
    if (d.limit !== undefined && d.limit !== null) {
      if (typeof d.limit !== 'number') {
        ctx.addIssue({
          code: 'custom',
          path: ['limit'],
          message: V.timeline.limitMustBeNumber,
        });
      } else if (
        d.limit < VALIDATION_PAGINATION.LIMIT_MIN ||
        d.limit > VALIDATION_PAGINATION.LIMIT_MAX ||
        !Number.isInteger(d.limit)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['limit'],
          message: V.timeline.limitRange,
        });
      }
    }
    // event_type: optional — non-string → one key; SECURITY allowlist miss → another key.
    if (d.event_type !== undefined && d.event_type !== null) {
      if (typeof d.event_type !== 'string') {
        ctx.addIssue({
          code: 'custom',
          path: ['event_type'],
          message: V.timeline.eventTypeMustBeString,
        });
      } else if (
        !(TIMELINE_EVENT_TYPES as readonly string[]).includes(d.event_type)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['event_type'],
          message: V.timeline.eventTypeInvalid,
        });
      }
    }
  });

// Typed witness-only schema (NOT executed) — see DECISION above. z.infer == ADMIN_GET_USER_TIMELINE REQUEST.
const getUserTimelineBindingSchema = z.object({
  user_id: z.string(),
  page: z.number().optional(),
  limit: z.number().optional(),
  event_type: z.enum(TIMELINE_EVENT_TYPES).optional(),
});

// ── adminGetLogs ──────────────────────────────────────────────────────────────
// DECISION (nie usuwaj tego komentarza):
// Wszystkie trzy wymiary są opcjonalne i walidowane TYLKO gdy podane (undefined →
// pominięte, null → odrzucone — zachowanie scharakteryzowane dla `environment`).
// `environment` ZACIEŚNIONE z `z.string()` do enuma (2026-08-19): wartości pochodzą
// wyłącznie z listy w panelu, więc dowolny string był luźniejszy niż potrzeba.
// Log-store trzyma też wartości historyczne (`UNKNOWN` sprzed BDX W6.2, dawne stringi
// diagnostyczne) i one NIE stają się nieosiągalne — widać je przy braku filtru,
// bo pusty wymiar znaczy „wszystkie środowiska". Traci się jedynie możliwość
// zawężenia DO nich, czego panel i tak nie oferuje.
// Single schema (runtime == binding): z.infer == GET_LOGS REQUEST.
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const getLogsSchema = z.object({
  environment: z
    .enum(LOG_ENVIRONMENTS, { error: V.getLogs.environmentMustBeString })
    .optional(),
  application: z
    .enum(LOG_APPLICATIONS, { error: V.getLogs.applicationInvalid })
    .optional(),
  type: z.enum(SEND_LOG_TYPES, { error: V.getLogs.typeInvalid }).optional(),
  search: z
    .string({ error: V.getLogs.searchInvalid })
    .max(200, { error: V.getLogs.searchTooLong })
    .optional(),
  date_from: z
    .string({ error: V.getLogs.dateInvalid })
    .regex(ISO_DAY, { error: V.getLogs.dateInvalid })
    .optional(),
  date_to: z
    .string({ error: V.getLogs.dateInvalid })
    .regex(ISO_DAY, { error: V.getLogs.dateInvalid })
    .optional(),
  hide_startup_noise: z
    .boolean({ error: V.getLogs.hideStartupNoiseInvalid })
    .optional(),
  cursor: z
    .number({ error: V.getLogs.cursorInvalid })
    .int({ error: V.getLogs.cursorInvalid })
    .positive({ error: V.getLogs.cursorInvalid })
    .optional(),
  take: z
    .number({ error: V.getLogs.takeInvalid })
    .int({ error: V.getLogs.takeInvalid })
    .min(1, { error: V.getLogs.takeInvalid })
    .max(LOG_STREAM_MAX_TAKE, { error: V.getLogs.takeInvalid })
    .optional(),
});

const getLogDetailsSchema = z.object({
  id: z
    .number({ error: V.getLogDetails.idInvalid })
    .int({ error: V.getLogDetails.idInvalid })
    .positive({ error: V.getLogDetails.idInvalid }),
});

// ── adminGetLogGroups ─────────────────────────────────────────────────────────
// Te same trzy wymiary co strumień (agregacja nie przyjmuje szukania, dat
// ani kursora — te zostają przy GET_LOGS).
const getLogGroupsSchema = getLogsSchema
  .pick({
    environment: true,
    application: true,
    type: true,
  })
  .extend({
    // "Needs a reaction" view: the server replaces the three dimensions above
    // with LOG_ATTENTION_SCOPE (see GetLogGroupsRequest.attention).
    attention: z.boolean({ error: V.getLogs.attentionInvalid }).optional(),
  });

// ── adminSetLogIssueStatus ────────────────────────────────────────────────────
// `fingerprint` to md5 policzony po stronie serwera (32 znaki hex) — walidujemy
// KSZTAŁT, nie istnienie: odcisk bez odpowiadających logów jest legalny (grupa
// mogła właśnie wypaść z retencji, a status ma przeżyć swoje wystąpienia).
const setLogIssueStatusSchema = z.object({
  fingerprint: z
    .string({ error: V.logIssueStatus.fingerprintRequired })
    .regex(/^[0-9a-f]{32}$/, { error: V.logIssueStatus.fingerprintRequired }),
  status: z.enum(LOG_ISSUE_STATUSES, {
    error: V.logIssueStatus.statusInvalid,
  }),
  // Klucz typu MUSI być podany jawnie: bez niego zod na `note: 5` wypuszcza swój
  // domyślny angielski komunikat zamiast tokenu i18n (strażnik:
  // validation-i18n-fidelity.test.ts).
  note: z
    .string({ error: V.logIssueStatus.noteMustBeString })
    .max(LOG_ISSUE_NOTE_MAX_LENGTH, { error: V.logIssueStatus.noteTooLong })
    .optional(),
});

export const adminLogsValidators = {
  adminSendLog: (data: unknown) => zodValidate(sendLogRuntimeSchema, data),
  adminGetUserTimeline: (data: unknown) =>
    zodValidate(getUserTimelineRuntimeSchema, data),
  adminGetLogs: (data: unknown) => zodValidate(getLogsSchema, data),
  adminGetLogDetails: (data: unknown) => zodValidate(getLogDetailsSchema, data),
  adminGetLogGroups: (data: unknown) => zodValidate(getLogGroupsSchema, data),
  adminSetLogIssueStatus: (data: unknown) =>
    zodValidate(setLogIssueStatusSchema, data),
} as const;

// ── Compile-time REQUEST-DTO ↔ schema binding (drift stops compilation) ──
// One property per validator. For adminSendLog / adminGetUserTimeline the binding uses
// the dedicated typed witness schema (runtime schema is permissive by design — see the
// DECISION blocks above); adminGetLogs binds its single runtime schema directly.
export type AdminLogsRequestSchemaBindings = {
  adminSendLog: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof sendLogBindingSchema>,
      ADMIN_DTO_API_V1['SEND_LOG']['REQUEST']
    >
  >;
  adminGetUserTimeline: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof getUserTimelineBindingSchema>,
      ADMIN_DTO_API_V1['ADMIN_GET_USER_TIMELINE']['REQUEST']
    >
  >;
  adminGetLogGroups: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof getLogGroupsSchema>,
      ADMIN_DTO_API_V1['ADMIN_GET_LOG_GROUPS']['REQUEST']
    >
  >;
  adminSetLogIssueStatus: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof setLogIssueStatusSchema>,
      ADMIN_DTO_API_V1['ADMIN_SET_LOG_ISSUE_STATUS']['REQUEST']
    >
  >;
  adminGetLogs: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof getLogsSchema>,
      ADMIN_DTO_API_V1['GET_LOGS']['REQUEST']
    >
  >;
  adminGetLogDetails: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof getLogDetailsSchema>,
      ADMIN_DTO_API_V1['ADMIN_GET_LOG_DETAILS']['REQUEST']
    >
  >;
};
