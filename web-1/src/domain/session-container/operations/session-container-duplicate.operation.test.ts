import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionContainerLifecycleStateValue as State } from '@kernel/models/db_models.generated.dto';

const mocks = vi.hoisted(() => ({
  source: vi.fn(),
  pair: vi.fn(),
  guard: vi.fn(),
  limit: vi.fn(),
  count: vi.fn(),
  record: vi.fn(),
  create: vi.fn(),
  createPhotos: vi.fn(),
  detail: vi.fn(),
  lock: vi.fn(),
  salon: vi.fn(),
}));
const tx = {
  sessionContainer: { findFirst: mocks.source, create: mocks.create },
  galleryRecord: { findMany: mocks.record },
  sessionContainerPhoto: { createMany: mocks.createPhotos },
};
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    use: { $transaction: (fn: (value: unknown) => unknown) => fn(tx) },
  },
}));
vi.mock('@app/db/lock-rows', () => ({
  lockUserRow: mocks.lock,
  lockSessionContainer: vi.fn(),
}));
vi.mock('./session-container-shared.operations', () => ({
  findActivePairing: mocks.pair,
  isSalonReachedStylist_IO: mocks.limit,
  countSessionsTowardSharedLimit_IO: mocks.count,
}));
vi.mock('./session-container-pair-session.helper', () => ({
  assertNoOtherOpenPairSession: mocks.guard,
  findOtherOpenPairSessionId: vi.fn(),
  PairSessionExistsInTxError: class extends Error {
    constructor(
      readonly stylistAccountId: string,
      readonly existingSessionId: string
    ) {
      super();
    }
  },
}));
vi.mock('./session-container-queries.operations', () => ({
  loadSessionDetail_IO: mocks.detail,
}));
vi.mock('@domain/pairing/salon-access.resolver', () => ({
  canUseSalonPhotoInSession_IO: mocks.salon,
}));
vi.mock('@app/errors/error-result.helpers', () => ({
  databaseFailure: () => ({
    success: false,
    error: { type: 'DATABASE_ERROR' },
  }),
}));
import { duplicateSessionContainer_IO } from './session-container-duplicate.operation';
import { PairSessionExistsInTxError } from './session-container-pair-session.helper';

const args = {
  client_user_id: 'user',
  client_account_id: 'client',
  session_id: 'source',
};
const source = {
  id: 'source',
  name: 'Inspiracje',
  client_note: 'Na piątek',
  stylist_account_id: 'stylist',
  lifecycle_state: State.CLOSED,
  photos: [{ gallery_record_id: 'g1' }, { gallery_record_id: 'g2' }],
};
afterEach(() => vi.resetAllMocks());
function setup() {
  mocks.salon.mockResolvedValue(true);
  mocks.source.mockResolvedValue(source);
  mocks.pair.mockResolvedValue({ id: 'pair' });
  mocks.limit.mockResolvedValue(false);
  mocks.count.mockResolvedValue(0);
  mocks.record.mockResolvedValue([
    {
      gallery_record_id: 'g1',
      created_by_account_id: 'stylist',
      is_hidden: false,
    },
    {
      gallery_record_id: 'g2',
      created_by_account_id: 'stylist',
      is_hidden: true,
    },
  ]);
  mocks.create.mockResolvedValue({ id: 'new' });
  mocks.detail.mockResolvedValue({ success: true, data: { id: 'new' } });
}
describe('duplicateSessionContainer_IO', () => {
  it('rejects an existing draft without writes', async () => {
    setup();
    mocks.guard.mockRejectedValue(
      new PairSessionExistsInTxError('stylist', 'draft')
    );
    const result = await duplicateSessionContainer_IO(args);
    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'SESSION_CONTAINER_PAIR_SESSION_EXISTS',
        existingSessionId: 'draft',
      },
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.createPhotos).not.toHaveBeenCalled();
  });
  it('copies the note and visible photos in a single transaction', async () => {
    setup();
    expect(await duplicateSessionContainer_IO(args)).toMatchObject({
      success: true,
      data: { id: 'new' },
    });
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        client_note: source.client_note,
        lifecycle_state: State.READY,
      }),
    });
    expect(mocks.createPhotos).toHaveBeenCalledWith({
      data: [{ session_id: 'new', gallery_record_id: 'g1', position: 0 }],
    });
    expect(mocks.detail).toHaveBeenCalledWith('new', 'client', tx);
  });
  it('throws inside the transaction when detail hydration fails', async () => {
    setup();
    mocks.detail.mockResolvedValue({
      success: false,
      error: { type: 'DATABASE_ERROR' },
    });
    expect(await duplicateSessionContainer_IO(args)).toMatchObject({
      success: false,
      error: { type: 'DATABASE_ERROR' },
    });
  });
});
