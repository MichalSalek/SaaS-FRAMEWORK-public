import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminGetLogs_IO } from '@domain/admin/operations/admin-logs.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import {
  parseQueryParams,
  pBool,
  pNarrowed,
  pStr,
  type QueryParamParser,
} from '@app/http/parse-query-params';
import {
  isLogApplication,
  isLogEnvironment,
  LOG_STREAM_MAX_TAKE,
} from '@kernel/domain/admin/log-triage.config';
import { isSendLogType } from '@kernel/domain/admin/send-log.config';

type RequestParams = ADMIN_DTO_API_V1['GET_LOGS']['REQUEST'];

// Nieznana wartość jest POMIJANA (pNarrowed), nie odrzucana: filtry przychodzą
// z paska narzędzi panelu, a zgubiony wymiar ma zdegradować się do „bez filtru",
// nie wywalić widoku logów w momencie, gdy admin ich najbardziej potrzebuje.
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// A real calendar day only: the shape check let `2020-13-45` through to an Invalid
// Date and a Prisma 500, and `2021-02-30` silently became March 2 (testy-api s34).
const pIsoDay: QueryParamParser<string> = raw => {
  if (raw === null || !ISO_DAY.test(raw)) {
    return undefined;
  }
  const parsed = new Date(`${raw}T00:00:00Z`);
  // Month 13 is an Invalid Date and toISOString() THROWS on it (closing review
  // s34): check the time value first, then the round trip catches Feb 30.
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString().slice(0, 10) === raw ? raw : undefined;
};

// AppLogRecord.id is a 4-byte Int: a larger integer reached Prisma and failed its
// validation (500). Out of range = no cursor, like any other unusable value.
const PG_INT4_MAX = 2_147_483_647;

const pPositiveInt: QueryParamParser<number> = raw => {
  if (raw === null) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value <= PG_INT4_MAX
    ? value
    : undefined;
};

const pTake: QueryParamParser<number> = raw => {
  const value = pPositiveInt(raw);
  if (value === undefined) {
    return undefined;
  }
  return Math.min(value, LOG_STREAM_MAX_TAKE);
};

const pSearch: QueryParamParser<string> = raw => {
  const value = pStr(raw);
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 200) : undefined;
};

const GET_LOGS_QUERY_SCHEMA = {
  environment: pNarrowed(isLogEnvironment),
  application: pNarrowed(isLogApplication),
  type: pNarrowed(isSendLogType),
  search: pSearch,
  date_from: pIsoDay,
  date_to: pIsoDay,
  hide_startup_noise: pBool,
  cursor: pPositiveInt,
  take: pTake,
} satisfies Record<keyof RequestParams, unknown>;

export default defineHandler<
  RequestParams,
  ADMIN_DTO_API_V1['GET_LOGS']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.ADMIN.GET_LOGS,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const body = parseQueryParams<RequestParams>(
      req.query,
      GET_LOGS_QUERY_SCHEMA
    );

    const result = await adminGetLogs_IO({ body, currentUser });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, result.data);
  },
});
