import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeStylistCurrentUser } from '../../../test-utils/fixtures';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
const { runtimeConfig, campaign, initialize, transaction } = vi.hoisted(() => {
  const runtimeConfig = { findUnique: vi.fn(), update: vi.fn() };
  const campaign = { upsert: vi.fn() };
  return {
    runtimeConfig,
    campaign,
    initialize: vi.fn(),
    transaction: vi.fn(
      async (
        run: (tx: {
          runtimeConfig: typeof runtimeConfig;
          emailLifecycleCampaign: typeof campaign;
        }) => Promise<unknown>
      ) => run({ runtimeConfig, emailLifecycleCampaign: campaign })
    ),
  };
});
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: { use: { runtimeConfig, $transaction: transaction } },
}));
vi.mock('@domain/email/operations/free-email.enrollment', () => ({
  initializeFreeEmailCampaign_IO: initialize,
}));
vi.mock('@app/event-log/event-log.client', () => ({
  writeRawEventLog_IO: vi.fn(),
}));
import { updateRuntimeConfig_IO } from './admin-runtime-config.operations';
const admin = () => ({
  ...makeStylistCurrentUser(),
  role_id: SystemRoleId.MASTER_ADMIN,
});
const entry = {
  id: 'config',
  key: 'FREE_EMAIL_MODE',
  value: 'OFF',
  value_type: 'string',
  description: null,
  is_predefined: true,
  updated_at: new Date('2026-10-20T09:00:00Z'),
};
describe('Free email runtime control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeConfig.findUnique.mockResolvedValue(entry);
    runtimeConfig.update.mockImplementation(
      async ({ data }: { data: { value: string } }) => ({
        ...entry,
        value: data.value,
      })
    );
  });
  it('rejects unknown modes before either operational write', async () => {
    const result = await updateRuntimeConfig_IO({
      currentUser: admin(),
      params: { key: 'FREE_EMAIL_MODE', value: 'AUTO' },
    });
    expect(result.success).toBe(false);
    expect(transaction).not.toHaveBeenCalled();
  });
  it('turns sending off atomically without reinitializing the cohort', async () => {
    const result = await updateRuntimeConfig_IO({
      currentUser: admin(),
      params: { key: 'FREE_EMAIL_MODE', value: 'OFF' },
    });
    expect(result.success).toBe(true);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(campaign.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { mode: 'OFF' } })
    );
    expect(initialize).not.toHaveBeenCalled();
  });
  it('enables preview without resetting the durable start date', async () => {
    const result = await updateRuntimeConfig_IO({
      currentUser: admin(),
      params: { key: 'FREE_EMAIL_MODE', value: 'PREVIEW' },
    });
    expect(result.success).toBe(true);
    expect(campaign.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { mode: 'PREVIEW' } })
    );
    expect(initialize).toHaveBeenCalledTimes(1);
  });
  it('refuses an unprivileged user before looking up config', async () => {
    const result = await updateRuntimeConfig_IO({
      currentUser: makeStylistCurrentUser(),
      params: { key: 'FREE_EMAIL_MODE', value: 'ON' },
    });
    expect(result.success).toBe(false);
    expect(runtimeConfig.findUnique).not.toHaveBeenCalled();
  });
});
