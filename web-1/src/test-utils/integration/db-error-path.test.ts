/**
 * Integration-handler test — database-error path (characterization).
 *
 * BDX W0.3 (część A): pins the CURRENT shape of the "DB threw" failure path
 * BEFORE the FAZA 2 standardization — this is the contract W3.2's databaseFailure
 * shape must preserve. When a domain operation's Prisma call throws a generic
 * error, it returns a DATABASE_ERROR OperationResult, which the error-mapper maps
 * to respondGeneralError → HTTP 500 + APPLICATION.GENERAL_ERROR (opaque: the
 * function name / cause are logged server-side, NEVER leaked to the client).
 *
 * Subject: gallery/create-gallery-record (already proven by create-gallery-record.test.ts).
 *
 * Gate = positive + negative:
 *   - NEGATIVE (DB throws): galleryRecord.create throws inside the tx → 500 GENERAL_ERROR.
 *   - POSITIVE (DB healthy): same flow without the throw → 201 success.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import handler from '../../pages/api/v1/gallery/create-gallery-record/index';
import { assetOwnershipStubs, mockApiHandler, mockDb } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import { makeCurrentUserOutput, makeStylistCurrentUser } from '../fixtures';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { NAIL_LENGTHS } from '@kernel/domain/gallery/nail-length.config';

const VALID_BODY = {
  asset_url: 'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1/sample.jpg',
  color_ids: ['color_1'],
  trait_ids: ['trait_1'],
  nail_length: NAIL_LENGTHS.MEDIUM,
} as const;

describe('DB-error path (POST gallery/create-gallery-record handler integration)', () => {
  beforeEach(() => {
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
    __setPermission(true);
  });

  it('NEGATIVE — a generic DB error inside the op → 500 GENERAL_ERROR (opaque, no leak)', async () => {
    mockDb({
      // PRO → unlimited: skips the runtime-config knob read and the post-create verify.
      stylistAccount: {
        findUnique: async () => ({ pricing_plan: PricingPlanValue.PRO }),
      },
      color: { findMany: async () => [{ id: 'color_1' }] },
      trait: { findMany: async () => [{ id: 'trait_1' }] },
      galleryRecord: {
        count: async () => 0,
        // DB throws a GENERIC error (not P2003/quota-rollback) → falls through to
        // databaseFailure() → DATABASE_ERROR → respondGeneralError (500).
        create: async () => {
          throw new Error('db down');
        },
      },
    });

    const { status, event, data } = await mockApiHandler(handler, {
      method: 'POST',
      body: VALID_BODY,
    });

    expect(status).toBe(500);
    expect(event).toBe(APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR);
    // Opaque body: respondGeneralError(res, undefined) — no function name / cause leaked.
    expect(data).toBeUndefined();
  });

  it('POSITIVE — healthy DB (create succeeds) → 201 with the new gallery_record_id', async () => {
    const ownership = assetOwnershipStubs();
    mockDb({
      ...ownership,
      stylistAccount: {
        ...ownership.stylistAccount,
        findUnique: async () => ({ pricing_plan: PricingPlanValue.PRO }),
      },
      color: { findMany: async () => [{ id: 'color_1' }] },
      trait: { findMany: async () => [{ id: 'trait_1' }] },
      galleryRecord: {
        ...ownership.galleryRecord,
        count: async () => 0,
        create: async () => ({ gallery_record_id: 'gr_created_test' }),
      },
    });

    const { status, event, data } = await mockApiHandler<{
      gallery_record_id: string;
    }>(handler, {
      method: 'POST',
      body: VALID_BODY,
    });

    expect(status).toBe(201);
    expect(event).toBe(APP_EVENTS.INFO.APPLICATION.SUCCESS);
    expect(data.gallery_record_id).toBe('gr_created_test');
  });

  it('RETURNED request-attributable failure — P2002 inside the op → 409, not 500', async () => {
    const ownership = assetOwnershipStubs();
    mockDb({
      ...ownership,
      stylistAccount: {
        ...ownership.stylistAccount,
        findUnique: async () => ({ pricing_plan: PricingPlanValue.PRO }),
      },
      color: { findMany: async () => [{ id: 'color_1' }] },
      trait: { findMany: async () => [{ id: 'trait_1' }] },
      galleryRecord: {
        ...ownership.galleryRecord,
        count: async () => 0,
        create: async () => {
          throw Object.assign(new Error('Unique constraint failed'), {
            code: 'P2002',
          });
        },
      },
    });

    const { status, event, data } = await mockApiHandler(handler, {
      method: 'POST',
      body: VALID_BODY,
    });

    expect(status).toBe(409);
    expect(event).toBe(APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED);
    expect(data).toBeUndefined();
  });

  it('THROWN request-attributable failure outside any try (NUL → 22021 in the asset gate) → 400, not 500', async () => {
    const nulByteRejection = Object.assign(new Error('invalid byte sequence'), {
      name: 'DriverAdapterError',
      cause: { kind: 'postgres', originalCode: '22021' },
    });
    const ownership = assetOwnershipStubs();
    mockDb({
      ...ownership,
      stylistAccount: {
        ...ownership.stylistAccount,
        findUnique: async () => ({ pricing_plan: PricingPlanValue.PRO }),
      },
      color: { findMany: async () => [{ id: 'color_1' }] },
      trait: { findMany: async () => [{ id: 'trait_1' }] },
      galleryRecord: {
        ...ownership.galleryRecord,
        findFirst: async () => {
          throw nulByteRejection;
        },
        count: async () => 0,
      },
    });

    const { status, event } = await mockApiHandler(handler, {
      method: 'POST',
      body: VALID_BODY,
    });

    expect(status).toBe(400);
    expect(event).toBe(APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED);
  });

  it('control char in asset_url (%00) → 400 before any DB query', async () => {
    const ownership = assetOwnershipStubs();
    mockDb({
      ...ownership,
      stylistAccount: {
        ...ownership.stylistAccount,
        findUnique: async () => ({ pricing_plan: PricingPlanValue.PRO }),
      },
      color: { findMany: async () => [{ id: 'color_1' }] },
      trait: { findMany: async () => [{ id: 'trait_1' }] },
      galleryRecord: {
        ...ownership.galleryRecord,
        findFirst: async () => {
          throw new Error('the gate must not query with a NUL public_id');
        },
        count: async () => 0,
      },
    });

    const { status, event, data } = await mockApiHandler<{
      field: string;
      message: string;
    }>(handler, {
      method: 'POST',
      body: {
        ...VALID_BODY,
        asset_url:
          'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1/sam%00ple.jpg',
      },
    });

    expect(status).toBe(400);
    expect(event).toBe(APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED);
    // Since s34 the REQUEST VALIDATOR rejects it first (`%` is outside the URL-safe
    // set of isCloudinaryAssetUrl). The gate's own NUL handling stays as the second
    // layer for stored rows and is pinned in cloudinary-url.utils.test.ts; the
    // throwing findFirst above proves no query ran either way.
    expect(data).toHaveProperty('asset_url');
  });
});
