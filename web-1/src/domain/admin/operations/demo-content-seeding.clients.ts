import { DB_CLIENT } from '@app/db/db.client';
import {
  AccountTypeValue,
  PairingStatusValue,
} from '@kernel/models/db_models.generated.dto';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { TIME } from '@kernel/application/constants.config';
import { DEMO_NEW_CLIENTS } from './demo-content-seeding.clients-data';

export interface DemoClientAccounts {
  userId: string;
  clientAccountId: string;
}

/**
 * Konto klientki demo po slugu — BRAK RZUCA.
 *
 * DECISION: a miss throws, never a silent `continue`. The map is built by ensureNewClients_IO from
 * the same DEMO_NEW_CLIENTS constant every caller iterates, so a miss is a broken invariant, not an
 * environment state; skipping it silently dropped the client's whole visit history and message thread
 * while the seed reported success. Same rule as an unknown file name in demo-content-seeding.bank.ts.
 */
export const requireDemoClient = (
  clientsBySlug: Map<string, DemoClientAccounts>,
  slug: string
): DemoClientAccounts => {
  const client = clientsBySlug.get(slug);
  if (client === undefined) {
    throw new Error(
      `Demo seed: klientka "${slug}" nie zostala utworzona (DEMO_NEW_CLIENTS vs ensureNewClients_IO)`
    );
  }
  return client;
};

export const ensureNewClients_IO = async ({
  results,
  specs = DEMO_NEW_CLIENTS,
}: {
  results: string[];
  /** Default is those seven clients; the community layer passes its own list. */
  specs?: readonly { slug: string; email: string; displayName: string }[];
}): Promise<Map<string, DemoClientAccounts>> => {
  const emails = specs.map(c => c.email);

  const existingUsers = await DB_CLIENT.use.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true },
  });
  const existingEmails = new Set(existingUsers.map(u => u.email));
  const missingClients = specs.filter(c => !existingEmails.has(c.email));

  if (missingClients.length > 0) {
    await DB_CLIENT.use.user.createMany({
      data: missingClients.map(c => ({
        email: c.email,
        name: c.displayName,
        role_id: SystemRoleId.CLIENT_ROLE,
        account_type: AccountTypeValue.CLIENT,
        emailVerified: true,
      })),
      skipDuplicates: true,
    });
    results.push(`Demo new clients created (${missingClients.length})`);
  }

  const allUsers = await DB_CLIENT.use.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true },
  });
  const userIdByEmail = new Map(allUsers.map(u => [u.email, u.id]));

  const userIds = allUsers.map(u => u.id);
  const existingClientAccounts = await DB_CLIENT.use.clientAccount.findMany({
    where: { created_by_user_id: { in: userIds } },
    select: { client_account_id: true, created_by_user_id: true },
  });
  const existingByUserId = new Set(
    existingClientAccounts.map(a => a.created_by_user_id)
  );
  const missingAccountUserIds = userIds.filter(id => !existingByUserId.has(id));

  if (missingAccountUserIds.length > 0) {
    const emailByUserId = new Map(allUsers.map(u => [u.id, u.email]));
    await DB_CLIENT.use.clientAccount.createMany({
      data: missingAccountUserIds.map(userId => ({
        created_by_user_id: userId,
        contact_email: emailByUserId.get(userId) ?? null,
      })),
      skipDuplicates: true,
    });
  }

  const allClientAccounts = await DB_CLIENT.use.clientAccount.findMany({
    where: { created_by_user_id: { in: userIds } },
    select: { client_account_id: true, created_by_user_id: true },
  });
  const clientAccountByUserId = new Map(
    allClientAccounts.map(a => [a.created_by_user_id, a.client_account_id])
  );

  const bySlug = new Map<string, DemoClientAccounts>();
  for (const spec of specs) {
    const userId = userIdByEmail.get(spec.email);
    const clientAccountId = userId
      ? clientAccountByUserId.get(userId)
      : undefined;
    if (userId && clientAccountId) {
      bySlug.set(spec.slug, { userId, clientAccountId });
    }
  }
  return bySlug;
};

/**
 * Client-to-Ania pairs plus the CRM note. A small loop (7 pairs), find-or-create
 * on the unique key (client_user_id, stylist_account_id), self-healing like the
 * main demo pair (ensureDemoAccounts_IO). paired_at is set only on create
 * (staggered by pairedDaysAgo from the data), so a later seed does not move
 * an existing pair's history.
 */
export const ensureNewClientPairs_IO = async ({
  stylistAccountId,
  clientsBySlug,
  now,
}: {
  stylistAccountId: string;
  clientsBySlug: Map<string, DemoClientAccounts>;
  now: Date;
}): Promise<void> => {
  for (const spec of DEMO_NEW_CLIENTS) {
    const client = requireDemoClient(clientsBySlug, spec.slug);
    const pairedAt = new Date(
      now.getTime() - spec.pairedDaysAgo * TIME.MS_PER_DAY
    );
    await DB_CLIENT.use.clientStylistPair.upsert({
      where: {
        client_user_id_stylist_account_id: {
          client_user_id: client.userId,
          stylist_account_id: stylistAccountId,
        },
      },
      create: {
        client_user_id: client.userId,
        stylist_account_id: stylistAccountId,
        status: PairingStatusValue.ACTIVE,
        paired_at: pairedAt,
        crm_note: spec.crmNote,
        crm_note_updated_at: new Date(
          now.getTime() - spec.crmNoteUpdatedDaysAgo * TIME.MS_PER_DAY
        ),
      },
      update: {
        status: PairingStatusValue.ACTIVE,
        revoked_at: null,
        crm_note: spec.crmNote,
        crm_note_updated_at: new Date(
          now.getTime() - spec.crmNoteUpdatedDaysAgo * TIME.MS_PER_DAY
        ),
      },
    });
  }
};
