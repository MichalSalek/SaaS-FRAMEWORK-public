/**
 * The business logic receives the PARSER'S OUTPUT, never the request
 * body cast to T. Transforms (trim, default, coerce) reach the handler, unknown keys are stripped, a
 * dangerous key is rejected before the logic runs, a bodyless endpoint gets `{}`, and the 400 payload
 * stays the per-field error DTO. Every transform case here failed on the old middleware, which handed
 * the coalesced request body to the logic.
 *
 * Runs the REAL middleware with the REAL kernel validators; auth and permissions are stubbed
 * (setup.ts) so the payload path is what is measured.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMocks, type RequestMethod } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  NO_VALIDATION,
  VALIDATION_POLICY,
  type ValidationFunction,
} from '@kernel/policies/validation.policy';
import { __setCurrentUser, __setPermission } from '../../test-utils/setup';
import {
  makeCurrentUserOutput,
  makeStylistCurrentUser,
} from '../../test-utils/fixtures';
import { HTTPRequestHandlerMiddleware } from './request.middleware';

const QUERY_EVENT = APP_EVENTS.QUERIES.FAVORITE.FAVORITE_GET_RECORDS;

const run = async <T>(
  validationFunction: ValidationFunction<T>,
  body: unknown,
  options: { method?: RequestMethod; headers?: Record<string, string> } = {}
) => {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: options.method ?? 'GET',
    url: '/api/v1/test',
    ...(options.headers !== undefined && { headers: options.headers }),
  });
  req.body = body;
  const businessLogic = vi.fn(
    async (_payload: T, _ctx: unknown, _meta: unknown): Promise<void> => {
      res.status(200).json({ event: 'OK', data: null });
    }
  );
  await HTTPRequestHandlerMiddleware<T>(req, res, {
    contestedHTTPMethod: 'get',
    eventName: QUERY_EVENT,
    validationFunction,
    businessLogic,
  });
  // The 400 path answers with `send(object)`, the stub logic with `json()`: read both.
  const sent: unknown = res._getData();
  const envelope = (typeof sent === 'string' ? JSON.parse(sent) : sent) as {
    event?: unknown;
    data?: unknown;
  };
  return {
    status: res._getStatusCode(),
    event: envelope.event,
    data: envelope.data,
    businessLogic,
    payload: businessLogic.mock.calls[0]?.[0],
    metadata: businessLogic.mock.calls[0]?.[2],
  };
};

const VALID_VAT = {
  companyName: 'Studio Paznokci',
  nip: '5260250274',
  addressLine1: 'ul. Prosta 1',
  addressCity: 'Warszawa',
  addressPostalCode: '00-001',
};

describe('request.middleware: the handler receives the parsed payload', () => {
  beforeEach(() => {
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
    __setPermission(true);
  });

  it('trim: the handler sees the trimmed value, not the raw string', async () => {
    const out = await run(VALIDATION_POLICY.validators.vatInvoiceDetails, {
      ...VALID_VAT,
      companyName: '   Studio Paznokci   ',
      addressCity: ' Warszawa ',
    });
    expect(out.status).toBe(200);
    expect(out.payload).toMatchObject({
      companyName: 'Studio Paznokci',
      addressCity: 'Warszawa',
    });
  });

  it('default: a missing optional note reaches the handler as null', async () => {
    const out = await run(
      VALIDATION_POLICY.validators.favoriteUpdateRecordNote,
      { gallery_record_id: 'gr_1' }
    );
    expect(out.status).toBe(200);
    expect(out.payload).toEqual({ gallery_record_id: 'gr_1', note: null });
  });

  it('coerce: a query-string number reaches the handler as a number', async () => {
    const out = await run(VALIDATION_POLICY.validators.salonGallery, {
      salon_account_id: 'acc_1',
      take: '5',
    });
    expect(out.status).toBe(200);
    expect(out.payload).toEqual({ salon_account_id: 'acc_1', take: 5 });
  });

  it('unknown keys are stripped, including identity and prototype keys', async () => {
    const body: unknown = JSON.parse(
      '{"gallery_record_id":"gr_1","note":"ok","user_id":"someone_else","is_admin":true,"__proto__":{"polluted":true}}'
    );
    const out = await run(
      VALIDATION_POLICY.validators.favoriteUpdateRecordNote,
      body
    );
    expect(out.status).toBe(200);
    expect(out.payload).toEqual({ gallery_record_id: 'gr_1', note: 'ok' });
    expect(Object.getPrototypeOf(out.payload)).toBe(Object.prototype);
  });

  it('dangerous key: a salon staff role is rejected before the logic runs', async () => {
    const out = await run(VALIDATION_POLICY.validators.salonStaffUpdate, {
      role: 'OWNER',
      permissions: ['GALLERY_VIEW'],
    });
    expect(out.status).toBe(400);
    expect(out.event).toBe(APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED);
    expect(out.businessLogic).not.toHaveBeenCalled();
  });

  it('salon staff update without a role passes only the permissions list', async () => {
    const out = await run(VALIDATION_POLICY.validators.salonStaffUpdate, {
      permissions: ['GALLERY_VIEW'],
      staff_id: 'other_salon_staff',
    });
    expect(out.status).toBe(200);
    expect(out.payload).toEqual({ permissions: ['GALLERY_VIEW'] });
  });

  it('GET without a body contract: the handler receives {} whatever the body holds', async () => {
    const out = await run(NO_VALIDATION, { account_id: 'acc_other', take: 5 });
    expect(out.status).toBe(200);
    expect(out.payload).toEqual({});
  });

  it('NO_VALIDATION is not assignable to a request type that declares fields', () => {
    // NoPayload is branded: an all-optional request type cannot take NO_VALIDATION,
    // so a handler cannot believe it receives fields that are always absent.
    type Assignable =
      typeof NO_VALIDATION extends ValidationFunction<{ cursor?: string }>
        ? true
        : false;
    const assignable: Assignable = false;
    expect(assignable).toBe(false);
  });

  it('a non-object body is validated as {} (clean 400, never a 500)', async () => {
    for (const body of [null, [1, 2], 'text', 42]) {
      const out = await run(
        VALIDATION_POLICY.validators.favoriteUpdateRecordNote,
        body
      );
      expect(out.status, `body=${JSON.stringify(body)}`).toBe(400);
      expect(out.businessLogic).not.toHaveBeenCalled();
    }
  });

  it('the 400 payload is the per-field error DTO, without the verdict or any parsed data', async () => {
    const out = await run(VALIDATION_POLICY.validators.vatInvoiceDetails, {
      ...VALID_VAT,
      companyName: '   ',
    });
    expect(out.status).toBe(400);
    expect(out.data).not.toHaveProperty('__isValid');
    expect(out.data).not.toHaveProperty('__data');
    expect(out.data).toMatchObject({ __general: '', nip: '' });
    expect(
      (out.data as Record<string, string>)['companyName']?.trim()
    ).not.toBe('');
  });

  it('NUL protection still answers 400 before validation', async () => {
    const validator = vi.fn(NO_VALIDATION);
    const out = await run(validator, { note: 'a\u0000b' });
    expect(out.status).toBe(400);
    expect(validator).not.toHaveBeenCalled();
    expect(out.businessLogic).not.toHaveBeenCalled();
  });

  it('metadata: user metadata comes from the header, never from the body', async () => {
    const headerMetadata = {
      client_ip: null,
      location: 'PL',
      language: 'pl',
      user_agent: 'vitest',
    };
    const out = await run(
      NO_VALIDATION,
      { user_metadata: { language: 'xx' } },
      { headers: { 'user-metadata': JSON.stringify(headerMetadata) } }
    );
    expect(out.status).toBe(200);
    expect(out.payload).toEqual({});
    expect(out.metadata).toMatchObject({ location: 'PL', language: 'pl' });
  });
});
