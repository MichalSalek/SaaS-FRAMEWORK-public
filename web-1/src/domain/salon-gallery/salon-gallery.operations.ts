import {
  personAvatarSources,
  resolvePersonAvatarUrl,
} from '@kernel/domain/user/avatar.policy';
import {
  salonDisplayName,
  stylistDisplayName,
} from '@kernel/domain/salon-profile/salon-names';
import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import {
  success,
  failure,
  type OperationResult,
} from '@kernel/application/result.types';
import type {
  AccountNotFoundError,
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import type { SalonGalleryRequest } from '@kernel/models/salon-gallery/salon-gallery.dto';
import type { ContractHandlerResponse } from '@kernel/application/contracts/contract.types';
import type { SalonProfileContracts } from '@kernel/domain/salon-profile/salon-profile.contracts';
import { STYLIST_PUBLICLY_VISIBLE } from '@domain/account/account.config';
import { canManageSalonProfile } from '@domain/salon-profile/salon-profile.policy';
import { resolveAccessibleAuthorIds_IO } from '@domain/pairing/author-access';
import {
  GALLERY_COLORS_TRAITS_SELECT,
  mapGalleryColors,
  mapGalleryTraits,
} from '@domain/gallery/gallery.utils.api';
import type { Prisma } from '../../prisma/js-client';

export async function getSalonContributors_IO(
  salonAccountId: string,
  management = false
) {
  const owner = await DB_CLIENT.use.stylistAccount.findFirst({
    where: {
      account_id: salonAccountId,
      ...(!management ? STYLIST_PUBLICLY_VISIBLE : {}),
      created_by_user: { is_active: true, disabled_at: null },
    },
    include: { created_by_user: { select: { image: true, avatar_url: true } } },
  });
  if (!owner || (!management && !canManageSalonProfile(owner))) {
    return null;
  }
  const members = await DB_CLIENT.use.stylistAccount.findMany({
    where: {
      ...STYLIST_PUBLICLY_VISIBLE,
      created_by_user: {
        is_active: true,
        disabled_at: null,
        staff_memberships: {
          some: {
            stylist_account_id: salonAccountId,
            is_active: true,
            accepted_at: { not: null },
            public_profile_visible: true,
          },
        },
      },
    },
    // DECISION: Scale has no team seat ceiling. Enumerate metadata only for this salon, without an arbitrary cutoff
    // that hides later authors. Works remain cursor-paged (at most 51 rows), with no query per member.
    select: {
      account_id: true,
      display_name: true,
      business_name: true,
      avatar_url: true,
      vanity_url: true,
      created_by_user: { select: { image: true, avatar_url: true } },
    },
    orderBy: { account_id: 'asc' },
  });
  return {
    owner,
    contributors: [
      owner,
      ...members.filter(member => member.account_id !== owner.account_id),
    ].map(account => ({
      account_id: account.account_id,
      name: stylistDisplayName(account),
      avatar_url: resolvePersonAvatarUrl(account.created_by_user),
      avatar_fallback_url:
        personAvatarSources(account.created_by_user)[1] ?? null,
      identifier: account.vanity_url || account.account_id,
    })),
  };
}

// DECISION: public salon works are member pins, with the owner's showcase first. Full reads require a current salon
// connection or current team membership. One bounded record query joins colors, traits and showcase marks; author
// identities come from the same bounded contributor list, never per tile.
export async function getSalonGallery_IO({
  props,
  viewerUserId,
  publicOnly = false,
}: {
  props: SalonGalleryRequest;
  viewerUserId?: string;
  publicOnly?: boolean;
}): Promise<
  OperationResult<
    ContractHandlerResponse<SalonProfileContracts['SALON_GALLERY_GET']>,
    AccountNotFoundError | DatabaseError | ValidationError
  >
> {
  try {
    const team = await getSalonContributors_IO(props.salon_account_id);
    const unavailable = () =>
      failure({
        type: 'ACCOUNT_NOT_FOUND' as const,
        accountId: props.salon_account_id,
      });
    if (!team) {
      return unavailable();
    }
    const ids = team.contributors.map(person => person.account_id);
    // null = every contributor's private works (public view filters itself; a team member sees the team).
    let privateAuthorIds: string[] | null = null;
    if (!publicOnly) {
      if (!viewerUserId) {
        return unavailable();
      }
      const member =
        team.owner.created_by_user_id === viewerUserId ||
        Boolean(
          await DB_CLIENT.use.staffMember.findFirst({
            where: {
              user_id: viewerUserId,
              stylist_account_id: props.salon_account_id,
              is_active: true,
              accepted_at: { not: null },
            },
            select: { id: true },
          })
        );
      // DECISION: a connection to any contributing stylist opens the salon gallery. A client reads a
      // contributor's unpinned works only with access to THAT author (resolveAccessibleAuthorIds_IO, the same
      // per-author rule as her liked records): a member's explicit disconnect (REVOKED by STYLIST) hides that
      // member's private works here too. What the public salon page shows (pins, owner showcase) stays visible.
      if (!member) {
        privateAuthorIds = await resolveAccessibleAuthorIds_IO(
          viewerUserId,
          ids
        );
        if (privateAuthorIds.length === 0) {
          return unavailable();
        }
      }
    }
    if (props.stylist_account_id && !ids.includes(props.stylist_account_id)) {
      return unavailable();
    }
    const where: Prisma.GalleryRecordWhereInput = {
      is_hidden: false,
      created_by_account_id: props.stylist_account_id || { in: ids },
      ...(props.nail_length ? { nail_length: props.nail_length } : {}),
      ...(props.color_ids?.length
        ? { colors: { some: { color_id: { in: props.color_ids } } } }
        : {}),
      ...(props.trait_ids?.length
        ? { traits: { some: { trait_id: { in: props.trait_ids } } } }
        : {}),
    };
    const showcase = {
      salon_showcase_works: {
        some: { salon_account_id: props.salon_account_id },
      },
    };
    if (publicOnly) {
      where.OR = [{ is_pinned: true }, showcase];
    } else if (privateAuthorIds !== null) {
      // Composes with the stylist_account_id filter above: a filtered author without access shows public works only.
      where.OR = [
        { is_pinned: true },
        showcase,
        { created_by_account_id: { in: privateAuthorIds } },
      ];
    }
    const take = Math.min(Math.max(props.take || 24, 1), 50);
    // Cursor carries the showcase partition plus the stable date/id key.
    let phase = 0;
    if (props.cursor) {
      const parts = props.cursor.split('|');
      const date = new Date(parts[1] || '');
      if (
        parts.length !== 3 ||
        !['0', '1'].includes(parts[0] || '') ||
        Number.isNaN(date.getTime()) ||
        !parts[2]
      ) {
        return failure({
          type: 'VALIDATION_ERROR',
          field: 'cursor',
          message: 'Invalid gallery cursor',
        });
      }
      phase = Number(parts[0]);
      where.AND = [
        {
          OR: [
            { created_at: { lt: date } },
            { created_at: date, gallery_record_id: { lt: parts[2] } },
          ],
        },
      ];
    }
    const query = (isShowcase: boolean, count: number) =>
      DB_CLIENT.use.galleryRecord.findMany({
        where: { ...where, ...(isShowcase ? showcase : { NOT: showcase }) },
        include: { ...GALLERY_COLORS_TRAITS_SELECT },
        orderBy: [{ created_at: 'desc' }, { gallery_record_id: 'desc' }],
        take: count,
      });
    const pinned = phase === 0 ? await query(true, take + 1) : [];
    let ordinary: Awaited<ReturnType<typeof query>> = [];
    if (pinned.length <= take) {
      if (phase === 0) {
        delete where.AND;
      }
      ordinary = await query(false, take + 1 - pinned.length);
    }
    const rows = [...pinned, ...ordinary];
    const records = rows.slice(0, take).map((record, index) => {
      const author = team.contributors.find(
        person => person.account_id === record.created_by_account_id
      );
      if (!author) {
        throw new Error('Missing salon contributor');
      }
      return {
        gallery_record_id: record.gallery_record_id,
        asset_url: record.asset_url,
        nail_length: record.nail_length,
        created_at: record.created_at,
        colors: mapGalleryColors(record.colors),
        traits: mapGalleryTraits(record.traits),
        author,
        is_showcase: index < pinned.length,
      };
    });
    const last = records.at(-1);
    return success({
      salon_account_id: props.salon_account_id,
      name: salonDisplayName(team.owner),
      contributors: team.contributors,
      records,
      nextCursor:
        rows.length > take && last
          ? `${last.is_showcase ? 0 : 1}|${new Date(last.created_at).toISOString()}|${last.gallery_record_id}`
          : null,
    });
  } catch (error) {
    return databaseFailure('getSalonGallery_IO', error);
  }
}
