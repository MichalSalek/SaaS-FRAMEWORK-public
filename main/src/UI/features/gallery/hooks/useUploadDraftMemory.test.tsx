import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadDraftSnapshot } from './uploadDraftMemory';

const draftMocks = vi.hoisted(() => ({
  tokenPresent: true,
  read: vi.fn(),
  write: vi.fn(),
  delete: vi.fn(),
  clearAll: vi.fn(),
  clearOtherUsers: vi.fn(),
}));

vi.mock('../../../shared/hooks/currentUser.query', () => ({
  hasSessionToken: () => draftMocks.tokenPresent,
}));

vi.mock('./uploadDraftPersistence', () => ({
  readPersistedUploadDraft: (...args: unknown[]) => draftMocks.read(...args),
  writePersistedUploadDraft: (...args: unknown[]) => draftMocks.write(...args),
  deletePersistedUploadDraft: (...args: unknown[]) =>
    draftMocks.delete(...args),
  clearPersistedUploadDrafts: (...args: unknown[]) =>
    draftMocks.clearAll(...args),
  clearOtherPersistedUploadDrafts: (...args: unknown[]) =>
    draftMocks.clearOtherUsers(...args),
}));

import { clearUploadDraftMemory } from './uploadDraftMemory';
import { useUploadDraftMemory } from './useUploadDraftMemory';

function draft(fileName: string): UploadDraftSnapshot {
  return {
    step: 2,
    step1Sub: 'crop',
    originalFile: new File([fileName], fileName, { type: 'image/jpeg' }),
    croppedFile: null,
    cropSelection: { unit: '%', x: 0, y: 0, width: 90, height: 90 },
    selectedColorIds: ['pink'],
    selectedTraitIds: ['glitter'],
    selectedLength: 'MEDIUM',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('useUploadDraftMemory persisted restore', () => {
  beforeEach(() => {
    clearUploadDraftMemory();
    draftMocks.tokenPresent = true;
    draftMocks.read.mockReset().mockResolvedValue(null);
    draftMocks.write.mockReset().mockResolvedValue(true);
    draftMocks.delete.mockReset().mockResolvedValue(undefined);
    draftMocks.clearAll.mockReset().mockResolvedValue(undefined);
    draftMocks.clearOtherUsers.mockReset().mockResolvedValue(undefined);
  });

  it('does not replace a photo selected while IndexedDB restore is pending', async () => {
    const pending = deferred<UploadDraftSnapshot | null>();
    draftMocks.read.mockReturnValueOnce(pending.promise);
    const restoreDraft = vi.fn();
    const resetDraft = vi.fn();
    const { rerender } = renderHook(
      ({ snapshot }: { snapshot: UploadDraftSnapshot | null }) =>
        useUploadDraftMemory({
          userId: 'stylist-a',
          snapshot,
          resetDraft,
          restoreDraft,
        }),
      { initialProps: { snapshot: null as UploadDraftSnapshot | null } }
    );

    const newlySelected = draft('new-photo.jpg');
    rerender({ snapshot: newlySelected });
    await act(async () => {
      pending.resolve(draft('old-saved-photo.jpg'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(restoreDraft).not.toHaveBeenCalled();
    expect(draftMocks.write).toHaveBeenCalledWith('stylist-a', newlySelected);
  });

  it('ignores an old account read after the authenticated identity changes', async () => {
    const oldAccountRead = deferred<UploadDraftSnapshot | null>();
    const newAccountRead = deferred<UploadDraftSnapshot | null>();
    draftMocks.read
      .mockReturnValueOnce(oldAccountRead.promise)
      .mockReturnValueOnce(newAccountRead.promise);
    const restoreDraft = vi.fn();
    const resetDraft = vi.fn();
    const { rerender } = renderHook(
      ({ userId }: { userId: string }) =>
        useUploadDraftMemory({
          userId,
          snapshot: null,
          resetDraft,
          restoreDraft,
        }),
      { initialProps: { userId: 'stylist-a' } }
    );

    rerender({ userId: 'stylist-b' });
    await act(async () => {
      oldAccountRead.resolve(draft('another-account.jpg'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(resetDraft).toHaveBeenCalledTimes(1);
    expect(restoreDraft).not.toHaveBeenCalled();
    expect(draftMocks.read).toHaveBeenNthCalledWith(1, 'stylist-a');
    expect(draftMocks.read).toHaveBeenNthCalledWith(2, 'stylist-b');
  });
});
