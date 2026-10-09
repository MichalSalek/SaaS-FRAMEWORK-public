/**
 * GDPR export, stylist side: session containers follow the stylist READ gate
 * (getSessionContainerById_IO), so a client's never-shared container (DRAFT,
 * READY, or closed/expired with shared_at === null) never reaches the stylist.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';

const { db } = vi.hoisted(() => ({
  db: { use: { sessionContainer: { findMany: vi.fn() } } },
}));

vi.mock('@app/db/db.client', () => ({ DB_CLIENT: db }));

import { collectStylistSessionContainers } from './export-user-data.collectors.extra';

describe('collectStylistSessionContainers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.use.sessionContainer.findMany.mockResolvedValue([]);
  });

  it('exports only containers the client actually shared', async () => {
    await collectStylistSessionContainers('sa_1', 50);

    expect(db.use.sessionContainer.findMany).toHaveBeenCalledTimes(1);
    const [args] = db.use.sessionContainer.findMany.mock.calls[0] as [
      { where: Record<string, unknown>; take: number },
    ];
    expect(args.where).toEqual({
      stylist_account_id: 'sa_1',
      shared_at: { not: null },
      lifecycle_state: {
        notIn: [
          SessionContainerLifecycleStateValue.DRAFT,
          SessionContainerLifecycleStateValue.READY,
        ],
      },
    });
    expect(args.take).toBe(50);
  });

  it('maps a shared container to the export shape', async () => {
    const sharedAt = new Date('2026-09-01T10:00:00.000Z');
    const createdAt = new Date('2026-08-31T10:00:00.000Z');
    db.use.sessionContainer.findMany.mockResolvedValue([
      {
        name: 'Wesele',
        lifecycle_state: SessionContainerLifecycleStateValue.CLOSED,
        stylist_note: 'note',
        client_note: 'client note',
        shared_at: sharedAt,
        expires_at: null,
        created_at: createdAt,
        client_account: { created_by_user: { name: 'Anna' } },
      },
    ]);

    const rows = await collectStylistSessionContainers('sa_1', 50);

    expect(rows).toEqual([
      {
        client_name: 'Anna',
        name: 'Wesele',
        lifecycle_state: SessionContainerLifecycleStateValue.CLOSED,
        stylist_note: 'note',
        client_note: 'client note',
        shared_at: sharedAt.toISOString(),
        expires_at: null,
        created_at: createdAt.toISOString(),
      },
    ]);
  });
});
