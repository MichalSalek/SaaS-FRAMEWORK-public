import { describe, expect, it } from 'vitest';
import {
  createUploadDraftPersistence,
  type PersistedUploadDraft,
  type UploadDraftPersistenceBackend,
} from './uploadDraftPersistence';
import type { UploadDraftSnapshot } from './uploadDraftMemory';

function draft(fileName = 'design.jpg'): UploadDraftSnapshot {
  return {
    step: 3,
    step1Sub: 'crop',
    originalFile: new File(['original-bytes'], fileName, {
      type: 'image/jpeg',
      lastModified: 123,
    }),
    croppedFile: new File(['cropped-bytes'], 'cropped.jpg', {
      type: 'image/jpeg',
      lastModified: 456,
    }),
    cropSelection: { unit: '%', x: 4, y: 8, width: 80, height: 75 },
    selectedColorIds: ['rose'],
    selectedTraitIds: ['chrome', 'style:minimal'],
    selectedLength: 'LONG',
  };
}

function memoryBackend(): UploadDraftPersistenceBackend & {
  records: Map<string, PersistedUploadDraft>;
} {
  const records = new Map<string, PersistedUploadDraft>();
  return {
    records,
    async get(userId) {
      return records.get(userId) ?? null;
    },
    async put(record) {
      records.set(record.userId, record);
    },
    async delete(userId) {
      records.delete(userId);
    },
    async clearAll() {
      records.clear();
    },
    async clearOtherUsers(userId) {
      for (const key of records.keys()) {
        if (key !== userId) {
          records.delete(key);
        }
      }
    },
  };
}

describe('upload draft persistence', () => {
  it('round-trips files and metadata only for the matching account', async () => {
    const backend = memoryBackend();
    const persistence = createUploadDraftPersistence({
      backend,
      now: () => 1_000,
    });

    expect(await persistence.write('stylist-a', draft())).toBe(true);
    const restored = await persistence.read('stylist-a');

    expect(await persistence.read('stylist-b')).toBeNull();
    expect(restored).toMatchObject({
      step: 3,
      step1Sub: 'crop',
      cropSelection: { unit: '%', x: 4, y: 8, width: 80, height: 75 },
      selectedColorIds: ['rose'],
      selectedTraitIds: ['chrome', 'style:minimal'],
      selectedLength: 'LONG',
    });
    expect(restored?.originalFile.name).toBe('design.jpg');
    expect(restored?.originalFile.lastModified).toBe(123);
    expect(await restored?.originalFile.text()).toBe('original-bytes');
    expect(restored?.croppedFile?.name).toBe('cropped.jpg');
    expect(await restored?.croppedFile?.text()).toBe('cropped-bytes');
  });

  it('serializes delete after a pending write so a cleared draft cannot reappear', async () => {
    const records = new Map<string, PersistedUploadDraft>();
    let releaseWrite!: () => void;
    let deleteStarted = false;
    const writeGate = new Promise<void>(resolve => {
      releaseWrite = resolve;
    });
    const backend: UploadDraftPersistenceBackend = {
      async get(userId) {
        return records.get(userId) ?? null;
      },
      async put(record) {
        await writeGate;
        records.set(record.userId, record);
      },
      async delete(userId) {
        deleteStarted = true;
        records.delete(userId);
      },
      async clearAll() {
        records.clear();
      },
      async clearOtherUsers(userId) {
        for (const key of records.keys()) {
          if (key !== userId) {
            records.delete(key);
          }
        }
      },
    };
    const persistence = createUploadDraftPersistence({ backend });

    const write = persistence.write('stylist-a', draft());
    const deletion = persistence.delete('stylist-a');
    await Promise.resolve();
    expect(deleteStarted).toBe(false);

    releaseWrite();
    await Promise.all([write, deletion]);

    expect(deleteStarted).toBe(true);
    expect(records.has('stylist-a')).toBe(false);
  });

  it('deletes expired drafts and treats unavailable storage as an optional failure', async () => {
    const backend = memoryBackend();
    const persistence = createUploadDraftPersistence({
      backend,
      now: () => 50_000,
      ttlMs: 1_000,
    });
    await persistence.write('stylist-a', draft());
    // Make the stored record older than the configured test TTL.
    const record = backend.records.get('stylist-a');
    if (record) {
      backend.records.set('stylist-a', { ...record, savedAt: 1 });
    }

    expect(await persistence.read('stylist-a')).toBeNull();
    expect(backend.records.has('stylist-a')).toBe(false);

    const unavailable = createUploadDraftPersistence({
      backend: {
        async get() {
          throw new Error('storage blocked');
        },
        async put() {
          throw new Error('quota unavailable');
        },
        async delete() {
          throw new Error('storage blocked');
        },
        async clearAll() {
          throw new Error('storage blocked');
        },
        async clearOtherUsers() {
          throw new Error('storage blocked');
        },
      },
    });
    expect(await unavailable.read('stylist-a')).toBeNull();
    expect(await unavailable.write('stylist-a', draft())).toBe(false);
    await expect(unavailable.delete('stylist-a')).resolves.toBeUndefined();
    await expect(unavailable.clearAll()).resolves.toBeUndefined();
    await expect(
      unavailable.clearOtherUsers('stylist-a')
    ).resolves.toBeUndefined();
  });

  it('keeps only the authenticated identity draft after a cold account activation', async () => {
    const backend = memoryBackend();
    const persistence = createUploadDraftPersistence({ backend });
    await persistence.write('stylist-a', draft('a.jpg'));
    await persistence.write('stylist-b', draft('b.jpg'));

    await persistence.clearOtherUsers('stylist-b');

    expect([...backend.records.keys()]).toEqual(['stylist-b']);
    expect(await persistence.read('stylist-a')).toBeNull();
    expect((await persistence.read('stylist-b'))?.originalFile.name).toBe(
      'b.jpg'
    );
  });
});
