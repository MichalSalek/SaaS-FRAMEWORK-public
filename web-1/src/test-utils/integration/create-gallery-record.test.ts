/**
 * Integration-handler test — POST create-gallery-record.
 *
 * Proves the harness loads a REAL Next.js API handler under the global mocks and
 * observes the true `{ event, data }` envelope through the production middleware
 * (CORS → rate-limit → method guard → auth → permission → account-state → validation
 * → business logic → error mapper). DB, auth, permission and run-after-response are
 * the only things mocked (setup.ts).
 *
 * LOCATION: lives in `src/test-utils/integration/` (NOT beside the handler under
 * `pages/`). Next.js collects every `*.ts` file under `pages/` as a route — an
 * `index.test.ts` there would leak a `/api/.../index.test` endpoint into the build.
 * Keeping integration tests outside `pages/` keeps `next build` route-surface clean.
 * W0.3 subagents: put handler tests HERE, import the handler by relative path.
 *
 * Two cases:
 *   1. Happy path (PRO plan, unlimited) → 201 + new gallery_record_id.
 *   2. Quota reached (FREE plan, count === limit) → 403 plan-limit envelope.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import handler from '../../pages/api/v1/gallery/create-gallery-record/index';
import { assetOwnershipStubs, mockApiHandler, mockDb } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import { makeCurrentUserOutput, makeStylistCurrentUser } from '../fixtures';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { NAIL_LENGTHS } from '@kernel/domain/gallery/nail-length.config';
import { PRICING_LIMITS_SSOT } from '@kernel/policies/pricing.policy';

const VALID_BODY = {
  asset_url: 'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1/sample.jpg',
  color_ids: ['color_1'],
  trait_ids: ['trait_1'],
  nail_length: NAIL_LENGTHS.MEDIUM,
} as const;

describe('POST /api/v1/gallery/create-gallery-record (handler integration)', () => {
  beforeEach(() => {
    // Authenticated stylist + permission granted (focus on business logic, not authz).
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
    __setPermission(true);
  });

  it('creates a record and returns 201 with the new gallery_record_id (PRO = unlimited)', async () => {
    const ownership = assetOwnershipStubs();
    mockDb({
      ...ownership,
      stylistAccount: {
        ...ownership.stylistAccount,
        // PRO → max_gallery_records = -1 (unlimited): skips runtime-config knob read
        // and the post-create verify branch.
        findUnique: async () => ({ pricing_plan: PricingPlanValue.PRO }),
      },
      // Active-reference curation gate: returned ids must match the requested set.
      color: { findMany: async () => [{ id: 'color_1' }] },
      trait: { findMany: async () => [{ id: 'trait_1' }] },
      galleryRecord: {
        ...ownership.galleryRecord,
        count: async () => 0,
        create: async () => ({ gallery_record_id: 'gr_created_test' }),
      },
      // incrementGalleryCount uses tx.$executeRaw → setup proxy returns 0 by default.
    });

    const { status, event, data } = await mockApiHandler<{
      gallery_record_id: string;
    }>(handler, {
      method: 'POST',
      body: VALID_BODY,
    });

    expect(status).toBe(201);
    // respondCreated defaults to APP_EVENTS.INFO.APPLICATION.SUCCESS.
    expect(event).toBe(APP_EVENTS.INFO.APPLICATION.SUCCESS);
    expect(data.gallery_record_id).toBe('gr_created_test');
  });

  it('returns 403 plan-limit when the FREE quota is already reached', async () => {
    const freeLimit = PRICING_LIMITS_SSOT.FREE.max_gallery_records;

    const ownership = assetOwnershipStubs();
    mockDb({
      ...ownership,
      stylistAccount: {
        ...ownership.stylistAccount,
        findUnique: async () => ({ pricing_plan: PricingPlanValue.FREE }),
      },
      // getRuntimeConfigValue('MAX_GALLERY_RECORDS', '5') → null ⇒ default '5' kept.
      runtimeConfig: { findUnique: async () => null },
      color: { findMany: async () => [{ id: 'color_1' }] },
      trait: { findMany: async () => [{ id: 'trait_1' }] },
      galleryRecord: {
        ...ownership.galleryRecord,
        // count === limit → pre-check `count >= limit` fast-fails inside the tx.
        count: async () => freeLimit,
        create: async () => {
          throw new Error('create must not be called when over quota');
        },
      },
    });

    const { status, event, data } = await mockApiHandler<{
      currentCount: number;
      limit: number;
      planType: string;
    }>(handler, {
      method: 'POST',
      body: VALID_BODY,
    });

    expect(status).toBe(403);
    expect(event).toBe(APP_EVENTS.INFO.APPLICATION.PLAN_LIMIT_REACHED_INFO);
    expect(data.limit).toBe(freeLimit);
    expect(data.planType).toBe(PricingPlanValue.FREE);
  });
});
