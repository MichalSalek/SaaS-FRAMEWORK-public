import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { hasSessionToken } from '../../../shared/hooks/currentUser.query';
import {
  activateUploadDraftIdentity,
  clearUploadDraftMemory,
  getUploadDraftIdentityGeneration,
  isUploadDraftIdentityActive,
  restoreUploadDraftMemory,
  saveUploadDraftMemory,
  type UploadDraftSnapshot,
} from './uploadDraftMemory';
import { readPersistedUploadDraft } from './uploadDraftPersistence';

interface UseUploadDraftMemoryOptions {
  userId: string | undefined;
  snapshot: UploadDraftSnapshot | null;
  resetDraft: () => void;
  restoreDraft: (snapshot: UploadDraftSnapshot) => void;
}

const useCommittedLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Retain one authenticated stylist's prepared upload across routes and full page returns. */
export function useUploadDraftMemory({
  userId,
  snapshot,
  resetDraft,
  restoreDraft,
}: UseUploadDraftMemoryOptions) {
  const ownerRef = useRef<string | null>(null);
  const generationRef = useRef<number | null>(null);
  const restoredIdentityRef = useRef<string | null>(null);
  const restoreAttemptRef = useRef(0);
  const successfulUploadRef = useRef(false);
  const snapshotRef = useRef<UploadDraftSnapshot | null>(null);
  const latestIdentityRef = useRef<string | undefined>(userId);
  const skipCurrentSaveRef = useRef(false);

  // Committed refs make an async IDB read lose to a newer user-selected draft.
  useCommittedLayoutEffect(() => {
    latestIdentityRef.current = userId;
    snapshotRef.current = snapshot;
    if (snapshot === null) {
      skipCurrentSaveRef.current = false;
    }
  }, [userId, snapshot]);

  useEffect(() => {
    const identity = userId ?? null;

    if (!hasSessionToken()) {
      restoreAttemptRef.current += 1;
      clearUploadDraftMemory();
      ownerRef.current = null;
      generationRef.current = null;
      restoredIdentityRef.current = null;
      successfulUploadRef.current = false;
      snapshotRef.current = null;
      skipCurrentSaveRef.current = true;
      resetDraft();
      return;
    }

    // The authenticated account query can lag behind the token on first mount.
    // Do not load or save a draft until the API has identified the token's owner.
    if (identity === null) {
      return;
    }

    if (ownerRef.current !== null && ownerRef.current !== identity) {
      restoreAttemptRef.current += 1;
      clearUploadDraftMemory(ownerRef.current);
      successfulUploadRef.current = false;
      snapshotRef.current = null;
      skipCurrentSaveRef.current = true;
      resetDraft();
    }

    ownerRef.current = identity;
    const inMemory = activateUploadDraftIdentity(identity);
    const generation = getUploadDraftIdentityGeneration(identity);
    generationRef.current = generation;

    if (restoredIdentityRef.current === identity) {
      return;
    }
    restoredIdentityRef.current = identity;

    if (snapshotRef.current !== null) {
      // A photo selected while the account query was pending wins over saved data.
      saveUploadDraftMemory(identity, snapshotRef.current, generation);
      return;
    }

    if (inMemory !== null) {
      successfulUploadRef.current = false;
      snapshotRef.current = inMemory;
      restoreDraft(inMemory);
      return;
    }

    const restoreAttempt = ++restoreAttemptRef.current;
    void readPersistedUploadDraft(identity)
      .then(saved => {
        const isStillCurrent =
          restoreAttemptRef.current === restoreAttempt &&
          ownerRef.current === identity &&
          latestIdentityRef.current === identity &&
          generationRef.current === generation &&
          isUploadDraftIdentityActive(identity, generation) &&
          hasSessionToken() &&
          snapshotRef.current === null &&
          !successfulUploadRef.current;

        if (!saved || !isStillCurrent) {
          return;
        }
        if (!restoreUploadDraftMemory(identity, saved, generation)) {
          return;
        }
        snapshotRef.current = saved;
        successfulUploadRef.current = false;
        restoreDraft(saved);
      })
      .catch(() => {
        // Storage is optional; an unavailable database must not block the upload flow.
      });
  }, [userId, resetDraft, restoreDraft]);

  useEffect(() => {
    const generation = generationRef.current;
    if (
      userId === undefined ||
      ownerRef.current !== userId ||
      generation === null ||
      snapshot === null ||
      successfulUploadRef.current ||
      skipCurrentSaveRef.current ||
      !hasSessionToken() ||
      !isUploadDraftIdentityActive(userId, generation)
    ) {
      return;
    }
    saveUploadDraftMemory(userId, snapshot, generation);
  }, [userId, snapshot]);

  // Preserve a final in-memory copy on route unmount, but never revive a cleared lease.
  useEffect(
    () => () => {
      restoreAttemptRef.current += 1;
      restoredIdentityRef.current = null;
      const owner = ownerRef.current;
      const generation = generationRef.current;
      const latest = snapshotRef.current;
      if (
        owner !== null &&
        generation !== null &&
        latest !== null &&
        latestIdentityRef.current === owner &&
        !successfulUploadRef.current &&
        hasSessionToken() &&
        isUploadDraftIdentityActive(owner, generation)
      ) {
        saveUploadDraftMemory(owner, latest, generation);
      }
    },
    []
  );

  const clear = useCallback(() => {
    const owner = userId ?? ownerRef.current;
    restoreAttemptRef.current += 1;
    if (owner !== null && owner !== undefined) {
      clearUploadDraftMemory(owner);
    }
    snapshotRef.current = null;
    skipCurrentSaveRef.current = true;
    successfulUploadRef.current = false;

    // Explicit reset/change-photo clears old bytes while keeping this authenticated
    // page's lease usable for a newly selected photo.
    if (
      owner !== null &&
      owner !== undefined &&
      latestIdentityRef.current === owner &&
      hasSessionToken()
    ) {
      activateUploadDraftIdentity(owner);
      generationRef.current = getUploadDraftIdentityGeneration(owner);
    }
  }, [userId]);

  const markSuccessful = useCallback(() => {
    restoreAttemptRef.current += 1;
    successfulUploadRef.current = true;
    snapshotRef.current = null;
    clearUploadDraftMemory(userId ?? ownerRef.current ?? undefined);
    generationRef.current = null;
  }, [userId]);

  return { clear, markSuccessful };
}
