// Aggregated taste of a stylist's clients: the tags of every inspiration photo
// shared in her sessions. Reads are lifetime-scoped and deliberately capped for
// tag aggregation; the two counters stay exact. Plan-gated in the pricing SSOT.

import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { sessionStylistRelationshipWhere } from '../session-activity.access';
import type { Prisma } from '../../../prisma/js-client';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';
import {
  success,
  type OperationResult,
} from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import {
  PRICING_POLICY,
  narrowPricingPlan,
} from '@kernel/policies/pricing.policy';

const TAG_AGGREGATION_LIMIT = 5000;
const TOP_TAGS = 3;

export type SessionInsightsDTO = {
  available: boolean;
  sessions_count: number;
  photos_count: number;
  top_colors: { name: string; hex_code: string; count: number }[];
  top_traits: { name: string; count: number }[];
  top_lengths: {
    length: 'SHORT' | 'MEDIUM' | 'LONG' | 'XL';
    count: number;
  }[];
};

const empty = (sessions: number, photos: number): SessionInsightsDTO => ({
  available: false,
  sessions_count: sessions,
  photos_count: photos,
  top_colors: [],
  top_traits: [],
  top_lengths: [],
});

export const getSessionInsights_IO = async ({
  stylist_account_id,
  pricing_plan,
}: {
  stylist_account_id: string;
  pricing_plan: PricingPlan;
}): Promise<OperationResult<SessionInsightsDTO, DatabaseError>> => {
  try {
    const readableSession: Prisma.SessionContainerWhereInput = {
      stylist_account_id,
      shared_at: { not: null },
      lifecycle_state: {
        notIn: [
          SessionContainerLifecycleStateValue.DRAFT,
          SessionContainerLifecycleStateValue.READY,
        ],
      },
      client_account: { created_by_user: { is_active: true } },
      AND: [sessionStylistRelationshipWhere(stylist_account_id)],
    };
    const [sessionsCount, photosCount] = await Promise.all([
      DB_CLIENT.use.sessionContainer.count({
        where: { ...readableSession, photos: { some: {} } },
      }),
      DB_CLIENT.use.sessionContainerPhoto.count({
        where: { session: readableSession },
      }),
    ]);

    const available =
      PRICING_POLICY.LIMITS[narrowPricingPlan(pricing_plan)]
        .can_view_client_insights;
    if (!available) {
      return success(empty(sessionsCount, photosCount));
    }

    const photoRows = await DB_CLIENT.use.sessionContainerPhoto.findMany({
      where: { session: readableSession },
      select: { gallery_record_id: true },
      orderBy: { created_at: 'desc' },
      take: TAG_AGGREGATION_LIMIT,
    });
    const recordIds = Array.from(
      new Set(photoRows.map(photo => photo.gallery_record_id))
    );
    if (recordIds.length === 0) {
      return success({
        available: true,
        sessions_count: sessionsCount,
        photos_count: photosCount,
        top_colors: [],
        top_traits: [],
        top_lengths: [],
      });
    }

    const [colorGroups, traitGroups, lengthGroups] = await Promise.all([
      DB_CLIENT.use.galleryRecordColor.groupBy({
        by: ['color_id'],
        where: { gallery_record_id: { in: recordIds } },
        _count: { color_id: true },
        orderBy: [{ _count: { color_id: 'desc' } }, { color_id: 'asc' }],
        take: TOP_TAGS,
      }),
      DB_CLIENT.use.galleryRecordTrait.groupBy({
        by: ['trait_id'],
        where: { gallery_record_id: { in: recordIds } },
        _count: { trait_id: true },
        orderBy: [{ _count: { trait_id: 'desc' } }, { trait_id: 'asc' }],
        take: TOP_TAGS,
      }),
      DB_CLIENT.use.galleryRecord.groupBy({
        by: ['nail_length'],
        where: { gallery_record_id: { in: recordIds } },
        _count: { nail_length: true },
        orderBy: [{ _count: { nail_length: 'desc' } }, { nail_length: 'asc' }],
      }),
    ]);

    const [colors, traits] = await Promise.all([
      DB_CLIENT.use.color.findMany({
        where: { id: { in: colorGroups.map(group => group.color_id) } },
        select: { id: true, name: true, hex_code: true },
      }),
      DB_CLIENT.use.trait.findMany({
        where: { id: { in: traitGroups.map(group => group.trait_id) } },
        select: { id: true, name: true },
      }),
    ]);
    const colorById = new Map(colors.map(color => [color.id, color]));
    const traitById = new Map(traits.map(trait => [trait.id, trait]));

    return success({
      available: true,
      sessions_count: sessionsCount,
      photos_count: photosCount,
      top_colors: colorGroups.flatMap(group => {
        const color = colorById.get(group.color_id);
        return color
          ? [
              {
                name: color.name,
                hex_code: color.hex_code,
                count: group._count.color_id,
              },
            ]
          : [];
      }),
      top_traits: traitGroups.flatMap(group => {
        const trait = traitById.get(group.trait_id);
        return trait
          ? [{ name: trait.name, count: group._count.trait_id }]
          : [];
      }),
      top_lengths: lengthGroups.map(group => ({
        length: group.nail_length,
        count: group._count.nail_length,
      })),
    });
  } catch (error) {
    return databaseFailure('getSessionInsights', error);
  }
};
