import type { Crop } from 'react-image-crop';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import {
  clearPersistedUploadDrafts,
  clearOtherPersistedUploadDrafts,
  deletePersistedUploadDraft,
  writePersistedUploadDraft,
} from './uploadDraftPersistence';

export interface UploadDraftSnapshot {
  step: 1 | 2 | 3;
  step1Sub: 'select' | 'crop';
  originalFile: File;
  croppedFile: File | null;
  cropSelection: Crop | null;
  selectedColorIds: string[];
  selectedTraitIds: string[];
  selectedLength: NailLength | null;
}

interface IdentityUploadDraft {
  userId: string;
  snapshot: UploadDraftSnapshot;
}

// Keep one active identity: a shared device must never expose another account's photo.
let activeDraft: IdentityUploadDraft | null = null;
let activeIdentityId: string | null = null;
const identityGenerations = new Map<string, number>();

function copySnapshot(snapshot: UploadDraftSnapshot): UploadDraftSnapshot {
  return {
    ...snapshot,
    cropSelection:
      snapshot.cropSelection === null ? null : { ...snapshot.cropSelection },
    selectedColorIds: [...snapshot.selectedColorIds],
    selectedTraitIds: [...snapshot.selectedTraitIds],
  };
}

function generationFor(userId: string): number {
  return identityGenerations.get(userId) ?? 0;
}

function invalidateIdentity(userId: string): void {
  identityGenerations.set(userId, generationFor(userId) + 1);
  if (activeDraft?.userId === userId) {
    activeDraft = null;
  }
  void deletePersistedUploadDraft(userId);
}

/** Keep synchronous in-memory access while the best-effort IndexedDB read runs. */
export function saveUploadDraftMemory(
  userId: string,
  snapshot: UploadDraftSnapshot,
  generation?: number
): void {
  if (generation !== undefined && generation !== generationFor(userId)) {
    return;
  }
  if (activeIdentityId !== null && activeIdentityId !== userId) {
    return;
  }

  activeIdentityId = userId;
  const saved = copySnapshot(snapshot);
  activeDraft = { userId, snapshot: saved };
  void writePersistedUploadDraft(userId, saved);
}

/** Read only for the matching account. A different account cannot observe the saved File. */
export function readUploadDraftMemory(
  userId: string
): UploadDraftSnapshot | null {
  if (activeDraft?.userId !== userId) {
    return null;
  }
  return copySnapshot(activeDraft.snapshot);
}

/** Bind the singleton to the authenticated identity and discard a prior account's draft. */
export function activateUploadDraftIdentity(
  userId: string
): UploadDraftSnapshot | null {
  if (activeIdentityId !== null && activeIdentityId !== userId) {
    invalidateIdentity(activeIdentityId);
  }
  activeIdentityId = userId;
  void clearOtherPersistedUploadDrafts(userId);
  return readUploadDraftMemory(userId);
}

/** Current lease prevents a hook from saving after logout or an account switch. */
export function getUploadDraftIdentityGeneration(userId: string): number {
  return generationFor(userId);
}

export function isUploadDraftIdentityActive(
  userId: string,
  generation: number
): boolean {
  return activeIdentityId === userId && generationFor(userId) === generation;
}

/** Cache an IndexedDB restore without scheduling another database write. */
export function restoreUploadDraftMemory(
  userId: string,
  snapshot: UploadDraftSnapshot,
  generation: number
): boolean {
  if (!isUploadDraftIdentityActive(userId, generation)) {
    return false;
  }
  activeDraft = { userId, snapshot: copySnapshot(snapshot) };
  return true;
}

/** Clear one account's draft, or the active draft during logout/identity teardown. */
export function clearUploadDraftMemory(userId?: string): void {
  const targetUserId = userId ?? activeIdentityId ?? activeDraft?.userId;
  if (targetUserId === undefined || targetUserId === null) {
    activeDraft = null;
    activeIdentityId = null;
    void clearPersistedUploadDrafts();
    return;
  }

  identityGenerations.set(targetUserId, generationFor(targetUserId) + 1);
  if (activeDraft?.userId === targetUserId) {
    activeDraft = null;
  }
  if (userId === undefined && activeIdentityId === targetUserId) {
    activeIdentityId = null;
  }
  if (userId === undefined) {
    void clearPersistedUploadDrafts();
  } else {
    void deletePersistedUploadDraft(targetUserId);
  }
}
