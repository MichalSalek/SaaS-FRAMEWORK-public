/**
 * Terms acceptance is recorded by onboarding (owner): only on an
 * explicit `true`, only while User.terms_accepted_at is empty (first acceptance
 * wins), inside the same transaction as the account write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { tx, db, audit } = vi.hoisted(() => {
  const audit = vi.fn();
  const tx = {
    clientAccount: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    stylistAccount: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: {
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(async () => ({
        avatar_url: null,
        avatar_public_id: null,
      })),
    },
    emailLifecycleCampaign: { findUnique: vi.fn(async () => null) },
  };
  const db = {
    use: {
      $transaction: vi.fn(
        async (run: (client: typeof tx) => Promise<unknown>) => run(tx)
      ),
    },
  };
  return { tx, db, audit };
});

vi.mock('@domain/email/operations/email-preferences.audit', () => ({
  scheduleEmailPreferenceAudit: audit,
}));
vi.mock('@app/db/lock-rows', () => ({
  lockStylistAccount: vi.fn(async () => ({ account_id: 'sa_1' })),
}));

vi.mock('@app/db/db.client', () => ({ DB_CLIENT: db }));
vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: vi.fn(),
}));
vi.mock('./reconcile-active-role.helper', () => ({
  lockUserForRoleChange: vi.fn(async () => undefined),
  reconcileActiveRole: vi.fn(async () => undefined),
}));
vi.mock('@domain/account/vanity-url.auto', () => ({
  assignAutoVanityUrl_IO: vi.fn(async () => undefined),
}));
const finish = vi.hoisted(() =>
  vi.fn(async (_userId: string, _trigger: string) => undefined)
);
vi.mock('@domain/salon-staff/salon-invitation-token.service', () => ({
  finishAcceptedSalonInvitations: finish,
}));

import {
  onboardAsClient_IO,
  onboardAsStylist_IO,
} from './user-onboarding.operations';

describe('onboarding records terms acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.clientAccount.findUnique.mockResolvedValue(null);
    tx.clientAccount.create.mockResolvedValue({ client_account_id: 'ca_1' });
    tx.user.updateMany.mockResolvedValue({ count: 1 });
  });

  it('stamps the first acceptance only while the column is empty', async () => {
    const result = await onboardAsClient_IO({
      userId: 'usr_1',
      termsAccepted: true,
    });

    expect(result.success).toBe(true);
    expect(tx.user.updateMany).toHaveBeenCalledTimes(1);
    const [args] = tx.user.updateMany.mock.calls[0] as [
      { where: unknown; data: { terms_accepted_at: unknown } },
    ];
    expect(args.where).toEqual({ id: 'usr_1', terms_accepted_at: null });
    expect(args.data.terms_accepted_at).toBeInstanceOf(Date);
  });

  it('still stamps when a concurrent writer created the account (P2002 heal)', async () => {
    tx.clientAccount.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ client_account_id: 'ca_race' });
    tx.clientAccount.create.mockRejectedValueOnce({ code: 'P2002' });

    const result = await onboardAsClient_IO({
      userId: 'usr_1',
      termsAccepted: true,
    });

    expect(result).toEqual({
      success: true,
      data: { client_account_id: 'ca_race' },
    });
    expect(tx.user.updateMany).toHaveBeenCalledTimes(1);
  });

  it('records nothing without an explicit acceptance', async () => {
    await onboardAsClient_IO({ userId: 'usr_1' });
    await onboardAsClient_IO({ userId: 'usr_1', termsAccepted: false });

    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });
});

describe('stylist onboarding cleans the public name', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.stylistAccount.findUnique.mockResolvedValue(null);
    tx.stylistAccount.create.mockResolvedValue({
      account_id: 'sa_1',
      vanity_url: 'set',
      email_trial_sequence: true,
      email_marketing: false,
    });
    tx.user.updateMany.mockResolvedValue({ count: 1 });
  });

  const createdData = (): { display_name: unknown; address_city: unknown } => {
    const [args] = tx.stylistAccount.create.mock.calls[0] as [
      { data: { display_name: unknown; address_city: unknown } },
    ];
    return args.data;
  };

  it('strips zero-width characters and stray whitespace like the account editor', async () => {
    const result = await onboardAsStylist_IO({
      userId: 'usr_1',
      displayName: '  Nails\u200B   & Co ',
      addressCity: ' Kraków ',
      emailMarketing: false,
    });

    expect(result.success).toBe(true);
    expect(createdData()).toMatchObject({
      display_name: 'Nails & Co',
      address_city: 'Kraków',
    });
  });

  it('stores null when nothing visible is left, and keeps null as not given', async () => {
    const result = await onboardAsStylist_IO({
      userId: 'usr_1',
      displayName: '\u200B\u200B\u200B',
      addressCity: null,
      emailMarketing: false,
    });

    expect(result.success).toBe(true);
    expect(createdData()).toMatchObject({
      display_name: null,
      address_city: null,
    });
  });
});

describe('stylist onboarding finishes accepted salon invitations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.stylistAccount.findUnique.mockResolvedValue(null);
    tx.stylistAccount.create.mockResolvedValue({
      account_id: 'sa_1',
      vanity_url: 'set',
      email_trial_sequence: true,
      email_marketing: false,
    });
    tx.user.updateMany.mockResolvedValue({ count: 1 });
  });

  it('finishes accepted invitations once the stylist account exists', async () => {
    const result = await onboardAsStylist_IO({
      userId: 'usr_1',
      displayName: 'Nails',
      addressCity: null,
      emailMarketing: false,
    });
    expect(finish).toHaveBeenCalledWith('usr_1', 'stylist account creation');
    expect(result).toEqual({
      success: true,
      data: { stylist_account_id: 'sa_1' },
    });
  });
});

describe('stylist registration email history', () => {
  const input = {
    userId: 'usr_1',
    displayName: null,
    addressCity: null,
    emailMarketing: true,
  };
  const account = {
    account_id: 'sa_1',
    vanity_url: 'set',
    email_trial_sequence: true,
    email_marketing: false,
  };
  beforeEach(() => {
    vi.clearAllMocks();
    tx.stylistAccount.findUnique.mockResolvedValue(null);
    tx.stylistAccount.findUniqueOrThrow.mockResolvedValue(account);
    tx.stylistAccount.create.mockImplementation(async () => ({
      ...account,
      email_marketing: true,
    }));
    tx.stylistAccount.update.mockImplementation(async () => ({
      ...account,
      email_marketing: true,
    }));
  });
  it('captures both an unchecked and a checked first choice, with no invented previous value', async () => {
    await onboardAsStylist_IO({ ...input, emailMarketing: false });
    expect(audit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: 'registration',
        before: null,
        after: { trial_sequence: true, marketing: false },
      })
    );
    await onboardAsStylist_IO(input);
    expect(audit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: 'registration',
        before: null,
        after: { trial_sequence: true, marketing: true },
      })
    );
  });
  it('uses the row read after locking, rather than the earlier stale snapshot', async () => {
    tx.stylistAccount.findUnique.mockResolvedValue({
      ...account,
      email_marketing: true,
    });
    await onboardAsStylist_IO(input);
    expect(audit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        before: { trial_sequence: true, marketing: false },
        after: { trial_sequence: true, marketing: true },
      })
    );
  });
  it('preserves and records the explicit choice after a concurrent creation', async () => {
    tx.stylistAccount.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(account);
    tx.stylistAccount.create.mockRejectedValueOnce({ code: 'P2002' });
    const result = await onboardAsStylist_IO(input);
    expect(result).toEqual({
      success: true,
      data: { stylist_account_id: 'sa_1' },
    });
    expect(tx.stylistAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          email_marketing: true,
          email_preferences: { marketing: true, trial_sequence: true },
        },
      })
    );
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'registration',
        before: { marketing: false, trial_sequence: true },
        after: { marketing: true, trial_sequence: true },
      })
    );
  });
  it('records no choice if the account transaction fails', async () => {
    tx.stylistAccount.create.mockRejectedValueOnce(new Error('write failed'));
    expect((await onboardAsStylist_IO(input)).success).toBe(false);
    expect(audit).not.toHaveBeenCalled();
  });
});
