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
 * 7 nowych klientek Ani (S111) — user + ClientAccount, bulk find-or-create.
 * Grupa jest mała (7 emaili), ale i tak fetch-existing → createMany
 * (skipDuplicates) zamiast per-wiersz upsertu (AGENTS.md „PRISMA - PERFORMANCE"):
 * dwa round-tripy zamiast czternastu.
 */
/**
 * Konto klientki demo po slugu — BRAK RZUCA.
 *
 * DECISION (nie usuwaj tego komentarza) — CICHY `continue` BYL TU KLAMSTWEM:
 * mape buduje `ensureNewClients_IO` z tej samej stalej `DEMO_NEW_CLIENTS`, po
 * ktorej iteruja wszyscy wolajacy, wiec chybienie nie jest stanem srodowiska
 * tylko zlamanym niezmiennikiem. Pomijane po cichu kosztowalo CALA historie
 * wizyt i CALY watek wiadomosci tej klientki, a seed i tak melodowal sukces —
 * wystawa byla wpol zbudowana i nikt sie o tym nie dowiadywal. Dom tego seeda
 * juz raz to rozstrzygnal: nazwa pliku spoza banku RZUCA
 * (demo-content-seeding.bank.ts), wiec literowka w slugu ma wybuchnac tak samo.
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
  /** Domyślnie 7 klientek S111; warstwa społeczności podaje własną listę. */
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
 * Pary klientka↔Ania + notatka CRM — mała pętla (7 par), find-or-create po
 * unikalnym kluczu (client_user_id, stylist_account_id), self-healing jak
 * para głównego demo-duo (ensureDemoAccounts_IO). paired_at ustawiany TYLKO
 * przy tworzeniu (staggerowany wg pairedDaysAgo z danych), żeby ponowny seed
 * nie przesuwał już istniejącej historii pary.
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
