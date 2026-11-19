import type { Prisma } from '../../prisma/js-client';
import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { acquireAdvisoryXactLock } from '@app/db/lock-rows';
import {
  failure,
  success,
  type OperationResult,
} from '@kernel/application/result.types';
import type {
  AccountNotFoundError,
  DatabaseError,
} from '@kernel/application/common-errors.types';
import type { ProfileLinkKind } from '@kernel/models/db_models.generated.dto';

type AliasClient = Pick<Prisma.TransactionClient, 'profileLinkAlias'>;

/** Serialize live and retired claims in the same kind/slug namespace. */
export const lockProfileLinkSlugs = async (
  tx: Prisma.TransactionClient,
  kind: ProfileLinkKind,
  slugs: readonly (string | null)[]
): Promise<void> => {
  for (const slug of [
    ...new Set(slugs.filter((value): value is string => Boolean(value))),
  ].sort()) {
    await acquireAdvisoryXactLock(tx, `profile-link:${kind}:${slug}`);
  }
};

/**
 * Inside the transaction that writes the new link: reserves the old one for this account and
 * releases her own alias for the new one (changing back to an earlier link of her own).
 */
async function retireProfileLink(
  tx: AliasClient,
  {
    kind,
    accountId,
    previousSlug,
    nextSlug,
  }: {
    kind: ProfileLinkKind;
    accountId: string;
    previousSlug: string | null;
    nextSlug: string | null;
  }
): Promise<void> {
  if (previousSlug === nextSlug) {
    return;
  }
  if (nextSlug) {
    await tx.profileLinkAlias.deleteMany({
      where: { kind, slug: nextSlug, account_id: accountId },
    });
  }
  if (previousSlug) {
    // skipDuplicates: the old link was live on THIS account, so no other account can hold it as an
    // alias; a duplicate is only a retried write of the same row.
    await tx.profileLinkAlias.createMany({
      data: [{ kind, slug: previousSlug, account_id: accountId }],
      skipDuplicates: true,
    });
  }
}

/**
 * The in-transaction half of a link change: re-checks that nobody retired the new link after the
 * pre-check (a race throws a P2002-coded error, which callers already map to „taken”), then retires
 * the old one.
 */
export async function claimProfileLink(
  tx: Prisma.TransactionClient,
  link: {
    kind: ProfileLinkKind;
    accountId: string;
    previousSlug: string | null;
    nextSlug: string | null;
  }
): Promise<void> {
  await lockProfileLinkSlugs(tx, link.kind, [link.previousSlug, link.nextSlug]);
  if (
    link.nextSlug &&
    (await isProfileLinkReservedByOther(tx, {
      kind: link.kind,
      slug: link.nextSlug,
      accountId: link.accountId,
    }))
  ) {
    throw Object.assign(new Error('PROFILE_LINK_RESERVED'), { code: 'P2002' });
  }
  await retireProfileLink(tx, link);
}

/** True when the slug is a retired link of ANOTHER account (unavailable, same as „taken”). */
export async function isProfileLinkReservedByOther(
  client: AliasClient,
  {
    kind,
    slug,
    accountId,
  }: { kind: ProfileLinkKind; slug: string; accountId: string }
): Promise<boolean> {
  const alias = await client.profileLinkAlias.findUnique({
    where: { kind_slug: { kind, slug } },
    select: { account_id: true },
  });
  return alias !== null && alias.account_id !== accountId;
}

/**
 * Public resolution of a retired link to the account's current link. Called by the public
 * pages only after the live lookup returned 404, so a live link always wins. Not found and a
 * deleted owner collapse to one ACCOUNT_NOT_FOUND (anti-enumeration, like the profile read).
 */
export async function resolveProfileLink_IO({
  kind,
  slug,
}: {
  kind: ProfileLinkKind;
  slug: string;
}): Promise<
  OperationResult<
    { account_id: string; current_slug: string | null },
    AccountNotFoundError | DatabaseError
  >
> {
  try {
    const alias = await DB_CLIENT.use.profileLinkAlias.findFirst({
      where: {
        kind,
        slug,
        // Visibility beyond an active owner is the target page's call: the redirect lands on the
        // live route, which applies the same rules as a direct visit.
        account: { created_by_user: { is_active: true } },
      },
      select: {
        account: {
          select: {
            account_id: true,
            vanity_url: true,
            salon_vanity_url: true,
          },
        },
      },
    });
    if (!alias) {
      return failure({ type: 'ACCOUNT_NOT_FOUND', accountId: slug });
    }
    return success({
      account_id: alias.account.account_id,
      current_slug:
        kind === 'SALON'
          ? alias.account.salon_vanity_url
          : alias.account.vanity_url,
    });
  } catch (error) {
    return databaseFailure('resolveProfileLink_IO', error);
  }
}
