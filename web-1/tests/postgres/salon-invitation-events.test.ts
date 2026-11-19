import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Invitations from '../../src/domain/salon-staff/salon-invitation-token.service';
import type * as SalonTeam from '../../src/domain/salon-staff/operations/salon-team.operations';
import type * as StaffInvitation from '../../src/domain/salon-staff/operations/salon-staff-invitation.operations';
import type * as SoftDelete from '../../src/domain/user/operations/user-soft-delete.operations';
import type * as UserState from '../../src/domain/user/operations/user-state.operations';
import type * as Recovery from '../../src/domain/user/operations/recovery/recovery.operations';
import type { UserWithRelations } from '../../src/READONLY-shared-kernel/models/user/user.types';
import { AUTH_DB_URL, createAuthDb, type AuthDb } from './auth-db.fixture';

/**
 * Every event that can complete an accepted salon invitation does so, and a
 * failure of ANOTHER invitation never fails the request whose own acceptance succeeded.
 *
 * Run: AUTH_HOT_PATH_DATABASE_URL=postgresql://…@localhost:3200/db npx vitest run \
 *   --config vitest.postgres.config.ts tests/postgres/salon-invitation-events.test.ts
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    get use() {
      if (holder.client === null) {
        throw new Error('Test database unavailable');
      }
      return holder.client;
    },
    useAppLogs: new Proxy(
      {},
      {
        get() {
          return async () => undefined;
        },
      }
    ),
  },
}));

describe.skipIf(AUTH_DB_URL === undefined)(
  'salon invitation events on real Postgres',
  () => {
    let db: AuthDb;
    let invitations: typeof Invitations;
    let team: typeof SalonTeam;
    let staff: typeof StaffInvitation;
    let softDelete: typeof SoftDelete;
    let userState: typeof UserState;
    let recovery: typeof Recovery;
    const failing = new Set<string>();

    // Every module reads DB_CLIENT.use at different times (recovery captures it at import), so the
    // seeder is wrapped once: inside a transaction, reading an invitation listed in `failing`
    // throws, which fails exactly that invitation's attachment.
    const wrapped = () => {
      const base = db.seeder;
      return new Proxy(base, {
        get(target, prop, receiver) {
          if (prop !== '$transaction') {
            return Reflect.get(target, prop, receiver);
          }
          return (run: unknown, options?: unknown) => {
            if (typeof run !== 'function') {
              return Reflect.apply(target.$transaction, target, [run, options]);
            }
            return target.$transaction(
              tx =>
                (run as (client: unknown) => Promise<unknown>)(
                  new Proxy(tx, {
                    get(t, p, r) {
                      if (p !== 'salonInvitation') {
                        return Reflect.get(t, p, r);
                      }
                      return new Proxy(t.salonInvitation, {
                        get(d, m, dr) {
                          if (m !== 'findUnique') {
                            return Reflect.get(d, m, dr);
                          }
                          return async (
                            args: Parameters<typeof d.findUnique>[0]
                          ) => {
                            const id = args.where.id;
                            if (typeof id === 'string' && failing.has(id)) {
                              throw new Error('simulated attach failure');
                            }
                            return d.findUnique(args);
                          };
                        },
                      });
                    },
                  })
                ),
              options as { timeout?: number } | undefined
            );
          };
        },
      });
    };

    const invitationId = async (key: string, salon: string) => {
      const row = await db.seeder.salonInvitation.findFirst({
        where: {
          email: `${key}@hot-path.test`,
          salon_account_id: `sa_${salon}`,
        },
        select: { id: true },
      });
      if (!row) {
        throw new Error('invitation not found');
      }
      return row.id;
    };

    const asUser = async (key: string): Promise<UserWithRelations> =>
      (await db.seeder.user.findUnique({
        where: { id: db.idOf(key) },
        include: { stylist_account: true, client_account: true },
      })) as unknown as UserWithRelations;

    beforeAll(async () => {
      db = await createAuthDb(AUTH_DB_URL ?? '');
      holder.client = wrapped();
      for (const salon of ['salonA', 'salonB', 'salonC']) {
        await db.seedUser(salon, 'STYLIST', 'STUDIO');
      }
      invitations = await vi.importActual<typeof Invitations>(
        '@domain/salon-staff/salon-invitation-token.service'
      );
      team = await vi.importActual<typeof SalonTeam>(
        '@domain/salon-staff/operations/salon-team.operations'
      );
      staff = await vi.importActual<typeof StaffInvitation>(
        '@domain/salon-staff/operations/salon-staff-invitation.operations'
      );
      softDelete = await vi.importActual<typeof SoftDelete>(
        '@domain/user/operations/user-soft-delete.operations'
      );
      userState = await vi.importActual<typeof UserState>(
        '@domain/user/operations/user-state.operations'
      );
      recovery = await vi.importActual<typeof Recovery>(
        '@domain/user/operations/recovery/recovery.operations'
      );
    }, 120000);

    afterAll(async () => {
      await db.drop();
    });

    it('token accept succeeds when ANOTHER pending invitation fails to attach', async () => {
      await db.seedUser('tok', 'STYLIST');
      await db.invite('tok', 'salonB', false);
      failing.add(await invitationId('tok', 'salonB'));
      const token = invitations.createInvitationToken();
      await db.seeder.salonInvitation.create({
        data: {
          salon_account_id: 'sa_salonA',
          email: 'tok@hot-path.test',
          token_hash: invitations.hashInvitationToken(token),
          expires_at: new Date(Date.now() + 86400000),
        },
      });
      const result = await invitations.acceptSalonInvitationToken_IO({
        token,
      });
      expect(result.success).toBe(true);
      const memberships = await db.membershipsOf('tok');
      expect(memberships.map(m => m.stylist_account_id)).toEqual(['sa_salonA']);
      expect(await db.pendingOf('tok')).toBe(1);
      failing.clear();
    });

    it('the accepted invitation’s own failure still surfaces, the others attach', async () => {
      await db.seedUser('own', 'STYLIST');
      await db.invite('own', 'salonA', false);
      await db.invite('own', 'salonB', false);
      const own = await invitationId('own', 'salonA');
      failing.add(own);
      await expect(
        invitations.attachAcceptedSalonInvitations_IO(db.idOf('own'), {
          required: own,
        })
      ).rejects.toThrow('simulated attach failure');
      expect(
        (await db.membershipsOf('own')).map(m => m.stylist_account_id)
      ).toEqual(['sa_salonB']);
      failing.clear();
    });

    it('in-app accept succeeds when ANOTHER pending invitation fails to attach', async () => {
      await db.seedUser('app', 'STYLIST');
      await db.invite('app', 'salonC', false);
      failing.add(await invitationId('app', 'salonC'));
      await db.seeder.salonInvitation.create({
        data: {
          salon_account_id: 'sa_salonA',
          email: 'app@hot-path.test',
          token_hash: invitations.hashInvitationToken(
            invitations.createInvitationToken()
          ),
          expires_at: new Date(Date.now() + 86400000),
        },
      });
      const result = await staff.respondToStaffInvitation_IO({
        userId: db.idOf('app'),
        staffMemberId: await invitationId('app', 'salonA'),
        response: 'ACCEPT',
      });
      expect(result.success).toBe(true);
      expect(
        (await db.membershipsOf('app')).map(m => m.stylist_account_id)
      ).toEqual(['sa_salonA']);
      failing.clear();
    });

    it('the team screen answers when an invitation fails to attach', async () => {
      await db.seedUser('screen', 'STYLIST');
      await db.invite('screen', 'salonA', false);
      failing.add(await invitationId('screen', 'salonA'));
      expect((await team.getMySalonTeams_IO(db.idOf('screen'))).success).toBe(
        true
      );
      expect(await db.pendingOf('screen')).toBe(1);
      failing.clear();
      expect((await team.getMySalonTeams_IO(db.idOf('screen'))).success).toBe(
        true
      );
      expect(await db.pendingOf('screen')).toBe(0);
    });

    it('reactivating a soft-deleted stylist attaches her pending invitation', async () => {
      await db.seedUser('back', 'STYLIST');
      await db.invite('back', 'salonA', false);
      await db.seeder.user.update({
        where: { id: db.idOf('back') },
        data: {
          is_active: false,
          deleted_at: new Date(),
          recovery_available: true,
        },
      });
      expect(
        await invitations.attachAcceptedSalonInvitations_IO(db.idOf('back'))
      ).toBeUndefined();
      expect(await db.pendingOf('back')).toBe(1);
      const result = await softDelete.reactivateAccount_IO({
        id: db.idOf('back'),
      });
      expect(result.success).toBe(true);
      expect(await db.pendingOf('back')).toBe(0);
      expect(await db.membershipsOf('back')).toHaveLength(1);
    });

    it('re-enabling a banned salon owner attaches her invitees', async () => {
      await db.seedUser('banned', 'STYLIST', 'STUDIO');
      await db.seedUser('waiting', 'STYLIST');
      await db.invite('waiting', 'banned', false);
      await db.seeder.user.update({
        where: { id: db.idOf('banned') },
        data: { is_active: false, disabled_at: new Date() },
      });
      await invitations.attachAcceptedSalonInvitations_IO(db.idOf('waiting'));
      expect(await db.pendingOf('waiting')).toBe(1);
      const result = await userState.enableUser_IO(await asUser('banned'));
      expect(result.success).toBe(true);
      expect(await db.pendingOf('waiting')).toBe(0);
      expect(await db.membershipsOf('waiting')).toHaveLength(1);
    });

    it('restoring a stylist account from the archive attaches her pending invitation', async () => {
      await db.seedUser('phoenix', 'CLIENT');
      await db.invite('phoenix', 'salonB', false);
      const backup = {
        id: 'old_phoenix',
        email: 'phoenix@hot-path.test',
        emailVerified: true,
        image: null,
        name: 'Phoenix',
        role_id: 'role_stylist',
        is_active: false,
        account_type: 'STYLIST',
        createdAt: new Date().toISOString(),
        client_account: null,
        stylist_account: {
          account_id: 'old_sa_phoenix',
          display_name: 'Phoenix',
          pricing_plan: 'FREE',
          payment_status: 'UNPAID',
          account_status: 'ACTIVE',
          business_name: null,
          address_street: null,
          address_city: null,
          address_postal_code: null,
          address_country: null,
          latitude: null,
          longitude: null,
          phone: null,
          website: null,
          description: null,
          vanity_url: null,
          gallery_record: [],
        },
      };
      await db.seeder.deletedUser.create({
        data: {
          user_id: 'old_phoenix',
          email: 'phoenix@hot-path.test',
          body: backup,
        },
      });
      const result = await recovery.restoreAccountFromBackup({
        userId: db.idOf('phoenix'),
        userEmail: 'phoenix@hot-path.test',
      });
      expect(result.success).toBe(true);
      expect(await db.pendingOf('phoenix')).toBe(0);
      expect(await db.membershipsOf('phoenix')).toHaveLength(1);
    });
  }
);
