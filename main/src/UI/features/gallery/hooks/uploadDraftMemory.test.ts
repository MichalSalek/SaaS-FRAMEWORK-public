import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activateUploadDraftIdentity,
  clearUploadDraftMemory,
  getUploadDraftIdentityGeneration,
  readUploadDraftMemory,
  saveUploadDraftMemory,
  type UploadDraftSnapshot,
} from './uploadDraftMemory';

const persistenceMocks = vi.hoisted(() => ({
  write: vi.fn(),
  delete: vi.fn(),
  clearAll: vi.fn(),
  clearOtherUsers: vi.fn(),
}));

vi.mock('./uploadDraftPersistence', () => ({
  writePersistedUploadDraft: (...args: unknown[]) =>
    persistenceMocks.write(...args),
  deletePersistedUploadDraft: (...args: unknown[]) =>
    persistenceMocks.delete(...args),
  clearPersistedUploadDrafts: (...args: unknown[]) =>
    persistenceMocks.clearAll(...args),
  clearOtherPersistedUploadDrafts: (...args: unknown[]) =>
    persistenceMocks.clearOtherUsers(...args),
}));

function draft(fileName = 'work.jpg'): UploadDraftSnapshot {
  return {
    step: 3,
    step1Sub: 'crop',
    originalFile: new File(['photo'], fileName, { type: 'image/jpeg' }),
    croppedFile: new File(['crop'], 'cropped.jpg', { type: 'image/jpeg' }),
    cropSelection: { unit: '%', x: 1, y: 2, width: 90, height: 90 },
    selectedColorIds: ['nude'],
    selectedTraitIds: ['chrome'],
    selectedLength: 'MEDIUM',
  };
}

describe('upload draft memory', () => {
  beforeEach(() => {
    clearUploadDraftMemory();
    persistenceMocks.write.mockReset().mockResolvedValue(false);
    persistenceMocks.delete.mockReset().mockResolvedValue(undefined);
    persistenceMocks.clearAll.mockReset().mockResolvedValue(undefined);
    persistenceMocks.clearOtherUsers.mockReset().mockResolvedValue(undefined);
  });

  it('isolates a prepared File by identity and discards it on identity switch', () => {
    const prepared = draft();
    saveUploadDraftMemory('stylist-a', prepared);

    expect(readUploadDraftMemory('stylist-a')?.originalFile).toBe(
      prepared.originalFile
    );
    expect(readUploadDraftMemory('stylist-b')).toBeNull();
    expect(activateUploadDraftIdentity('stylist-b')).toBeNull();
    expect(readUploadDraftMemory('stylist-a')).toBeNull();
  });

  it('removes stale persisted identities when activating after a cold start', () => {
    activateUploadDraftIdentity('stylist-b');

    expect(persistenceMocks.clearOtherUsers).toHaveBeenCalledWith('stylist-b');
  });

  it('clears the matching account draft on reset or logout', () => {
    saveUploadDraftMemory('stylist-a', draft());
    clearUploadDraftMemory('stylist-b');
    expect(readUploadDraftMemory('stylist-a')).not.toBeNull();

    clearUploadDraftMemory('stylist-a');
    expect(readUploadDraftMemory('stylist-a')).toBeNull();

    activateUploadDraftIdentity('stylist-b');
    saveUploadDraftMemory('stylist-b', draft('other.jpg'));
    clearUploadDraftMemory();
    expect(readUploadDraftMemory('stylist-b')).toBeNull();
  });

  it('rejects a stale save lease after logout and same-account reactivation', () => {
    activateUploadDraftIdentity('stylist-a');
    const oldGeneration = getUploadDraftIdentityGeneration('stylist-a');
    clearUploadDraftMemory();
    activateUploadDraftIdentity('stylist-a');

    saveUploadDraftMemory('stylist-a', draft('stale.jpg'), oldGeneration);

    expect(readUploadDraftMemory('stylist-a')).toBeNull();
    saveUploadDraftMemory(
      'stylist-a',
      draft('current.jpg'),
      getUploadDraftIdentityGeneration('stylist-a')
    );
    expect(readUploadDraftMemory('stylist-a')?.originalFile.name).toBe(
      'current.jpg'
    );
  });

  it('keeps the in-memory draft usable when persistent storage fails', () => {
    const prepared = draft();
    saveUploadDraftMemory('stylist-a', prepared);

    expect(persistenceMocks.write).toHaveBeenCalledWith(
      'stylist-a',
      expect.objectContaining({ originalFile: prepared.originalFile })
    );
    expect(readUploadDraftMemory('stylist-a')?.originalFile).toBe(
      prepared.originalFile
    );
  });

  it('clears persisted drafts on logout even before this module knows an owner', () => {
    clearUploadDraftMemory();

    expect(persistenceMocks.clearAll).toHaveBeenCalledOnce();
  });
});
