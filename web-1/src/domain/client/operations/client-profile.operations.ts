import { DB_CLIENT } from '@app/db/db.client';
import { isP2025 } from '@app/db/prisma-error';
import { lockActivePair } from '@app/db/lock-rows';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  ClientNotFoundError,
  ClientUnauthorizedAccessError,
} from '@kernel/domain/client/client-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { clientPairAccessIsCurrent } from '@domain/pairing/pair-access-current';

/**
 * Sanitize user input to prevent XSS attacks
 *
 * @param input - Raw user input string
 * @returns Sanitized string with HTML entities escaped
 */

const sanitizeInput = (input: string): string => {
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
};

/**
 * Update client contact information
 *
 * SECURITY: Input is sanitized to prevent XSS
 * VALIDATION: Empty/whitespace-only strings are converted to null
 */
export const updateClientContact_IO = async ({
  user_id,
  contact_phone,
  contact_email,
}: {
  user_id: string;
  // PATCH contract: `undefined` = field omitted (column untouched); `null` or '' =
  // explicit clear (column set to null); non-empty string = set. Matches the
  // Partial<Pick<ClientAccount,...>> request DTO (columns are `string | null`).
  contact_phone?: string | null | undefined;
  contact_email?: string | null | undefined;
}): Promise<
  OperationResult<
    { contact_phone: string | null; contact_email: string | null },
    ClientNotFoundError | DatabaseError
  >
> => {
  try {
    // Get client account
    const clientAccount = await DB_CLIENT.use.clientAccount.findUnique({
      where: { created_by_user_id: user_id },
    });

    if (!clientAccount) {
      return failure({
        type: 'CLIENT_NOT_FOUND',
        clientId: user_id,
      });
    }

    // DECISION: true PATCH semantics. The DTO is Partial, so a body with only contact_phone must not
    // clobber contact_email: undefined = omit the column, '' or whitespace = clear (null), non-empty
    // = sanitize + write. The handler maps an absent field to undefined (not ''), so the distinction
    // survives; the UI re-sends both fields, but direct API callers rely on the partial contract.
    const updateData: {
      contact_phone?: string | null;
      contact_email?: string | null;
    } = {};
    if (contact_phone !== undefined) {
      const trimmed = contact_phone?.trim();
      updateData.contact_phone = trimmed ? sanitizeInput(trimmed) : null;
    }
    if (contact_email !== undefined) {
      const trimmed = contact_email?.trim();
      updateData.contact_email = trimmed ? sanitizeInput(trimmed) : null;
    }

    // Update contact info
    const updated = await DB_CLIENT.use.clientAccount.update({
      where: { client_account_id: clientAccount.client_account_id },
      data: updateData,
      select: {
        contact_phone: true,
        contact_email: true,
      },
    });

    return success({
      contact_phone: updated.contact_phone,
      contact_email: updated.contact_email,
    });
  } catch (error) {
    // TOCTOU: findUnique and update run outside a transaction. If the account is
    // deleted between the two queries, Prisma's update throws P2025 (record not
    // found). Map it to CLIENT_NOT_FOUND (404) instead of letting databaseFailure
    // surface a generic 500 for what is really a gone-resource race.
    if (isP2025(error)) {
      return failure({ type: 'CLIENT_NOT_FOUND', clientId: user_id });
    }
    return databaseFailure('updateClientContact', error);
  }
};

/**
 * Get client profile (own profile)
 */
export const getClientProfile_IO = async ({
  user_id,
}: {
  user_id: string;
}): Promise<
  OperationResult<
    {
      contact_phone: string | null;
      contact_email: string | null;
      created_at: string;
    },
    ClientNotFoundError | DatabaseError
  >
> => {
  try {
    const clientAccount = await DB_CLIENT.use.clientAccount.findUnique({
      where: { created_by_user_id: user_id },
      select: {
        contact_phone: true,
        contact_email: true,
        created_at: true,
      },
    });

    if (!clientAccount) {
      return failure({
        type: 'CLIENT_NOT_FOUND',
        clientId: user_id,
      });
    }

    return success({
      contact_phone: clientAccount.contact_phone,
      contact_email: clientAccount.contact_email,
      created_at: clientAccount.created_at.toISOString(),
    });
  } catch (error) {
    return databaseFailure('getClientProfile', error);
  }
};

export const getClientContactForStylist_IO = async ({
  client_user_id,
  stylist_user_id,
  ip_address,
  user_agent,
}: {
  client_user_id: string;
  stylist_user_id: string;
  ip_address?: string | undefined;
  user_agent?: string | undefined;
}): Promise<
  OperationResult<
    {
      contact_phone: string | null;
      contact_email: string | null;
      client_name: string;
    },
    ClientNotFoundError | ClientUnauthorizedAccessError | DatabaseError
  >
> => {
  try {
    // After lockActivePair (FOR UPDATE on the active pair), read contact in
    // this transaction. A revoke that updates that row waits, or it committed
    // before the lock. web-1/src/application/db/lock-rows.test.ts calls the helper on a mock (order
    // and a present row). It does not run a revoke beside this read, and it
    // does not assert this helper's SQL. The transaction alone is not the order.
    const result = await DB_CLIENT.use.$transaction(
      async (
        tx
      ): Promise<
        OperationResult<
          {
            contact_phone: string | null;
            contact_email: string | null;
            client_name: string;
          },
          ClientNotFoundError | ClientUnauthorizedAccessError
        >
      > => {
        // 1. Get stylist account ID from user ID
        const stylistUser = await tx.user.findUnique({
          where: { id: stylist_user_id },
          select: {
            stylist_account: {
              select: {
                account_id: true,
              },
            },
          },
        });

        if (!stylistUser?.stylist_account) {
          return failure({
            type: 'CLIENT_UNAUTHORIZED_ACCESS',
            clientId: client_user_id,
            stylistAccountId: '', // Stylist doesn't have account
          });
        }

        // ACTIVE pair under lockActivePair, then the contact read below.
        // is_active (soft-deleted client) stays handled at step 3.
        const pairing = await lockActivePair(
          tx,
          client_user_id,
          stylistUser.stylist_account.account_id
        );

        const pairAccess = pairing
          ? await tx.clientStylistPair.findUnique({
              where: { id: pairing.id },
              select: { salon_origin_account_id: true },
            })
          : null;
        if (
          !pairAccess ||
          !(await clientPairAccessIsCurrent(
            pairAccess,
            client_user_id,
            stylistUser.stylist_account.account_id,
            tx
          ))
        ) {
          return failure({
            type: 'CLIENT_UNAUTHORIZED_ACCESS',
            clientId: client_user_id,
            stylistAccountId: stylistUser.stylist_account.account_id,
          });
        }

        // 3. Get client contact info
        const clientAccount = await tx.clientAccount.findUnique({
          where: { created_by_user_id: client_user_id },
          select: {
            contact_phone: true,
            contact_email: true,
            created_by_user: {
              select: {
                name: true,
                is_active: true,
              },
            },
          },
        });

        if (!clientAccount) {
          return failure({
            type: 'CLIENT_NOT_FOUND',
            clientId: client_user_id,
          });
        }

        // PRIVACY: A self-disabled / soft-deleted client (is_active === false)
        // must not leak contact info even while the pairing row stays ACTIVE
        // (soft-delete does not tear down pairings — DOMAIN_SSOT §13.1). Treat a
        // disabled client as not-found for the stylist so contact access stops
        // the moment the client deactivates.
        if (!clientAccount.created_by_user.is_active) {
          return failure({
            type: 'CLIENT_NOT_FOUND',
            clientId: client_user_id,
          });
        }

        await tx.contactAccessLog.create({
          data: {
            client_user_id,
            stylist_user_id,
            access_type: 'VIEW_CONTACT',
            ip_address: ip_address || null,
            user_agent: user_agent || null,
          },
        });

        return success({
          contact_phone: clientAccount.contact_phone,
          contact_email: clientAccount.contact_email,
          client_name: clientAccount.created_by_user.name,
        });
      }
    );

    return result;
  } catch (error) {
    return databaseFailure('getClientContactForStylist', error);
  }
};
