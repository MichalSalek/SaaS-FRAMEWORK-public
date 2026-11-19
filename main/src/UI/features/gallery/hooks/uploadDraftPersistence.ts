import type { Crop } from 'react-image-crop';
import { TIME } from '@kernel/application/constants.config';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import type { UploadDraftSnapshot } from './uploadDraftMemory';
import { indexedDbUploadDraftBackend } from './uploadDraftPersistence.indexeddb';

export const UPLOAD_DRAFT_TTL_MS = TIME.MS_PER_DAY;

interface PersistedFile {
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
}

export interface PersistedUploadDraft {
  version: 1;
  userId: string;
  savedAt: number;
  step: 1 | 2 | 3;
  step1Sub: 'select' | 'crop';
  originalFile: PersistedFile;
  croppedFile: PersistedFile | null;
  cropSelection: Crop | null;
  selectedColorIds: string[];
  selectedTraitIds: string[];
  selectedLength: NailLength | null;
}

/** Minimal database seam so ordering and storage-failure behavior stay deterministic in tests. */
export interface UploadDraftPersistenceBackend {
  get(userId: string): Promise<unknown | null>;
  put(record: PersistedUploadDraft): Promise<void>;
  delete(userId: string): Promise<void>;
  clearAll(): Promise<void>;
  clearOtherUsers(userId: string): Promise<void>;
}

interface UploadDraftPersistenceOptions {
  backend: UploadDraftPersistenceBackend;
  now?: () => number;
  ttlMs?: number;
}

export interface UploadDraftPersistence {
  read(userId: string): Promise<UploadDraftSnapshot | null>;
  write(userId: string, snapshot: UploadDraftSnapshot): Promise<boolean>;
  delete(userId: string): Promise<void>;
  clearAll(): Promise<void>;
  clearOtherUsers(userId: string): Promise<void>;
}

function copySnapshot(snapshot: UploadDraftSnapshot): UploadDraftSnapshot {
  return {
    ...snapshot,
    cropSelection:
      snapshot.cropSelection === null ? null : { ...snapshot.cropSelection },
    selectedColorIds: [...snapshot.selectedColorIds],
    selectedTraitIds: [...snapshot.selectedTraitIds],
  };
}

function persistFile(file: File): PersistedFile {
  return {
    blob: file.slice(0, file.size, file.type),
    name: file.name,
    type: file.type,
    lastModified: file.lastModified,
  };
}

function restoreFile(file: PersistedFile): File | null {
  if (typeof File === 'undefined' || !(file.blob instanceof Blob)) {
    return null;
  }
  return new File([file.blob], file.name, {
    type: file.type,
    lastModified: file.lastModified,
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPersistedFile(value: unknown): value is PersistedFile {
  return (
    isObject(value) &&
    value.blob instanceof Blob &&
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    typeof value.lastModified === 'number' &&
    Number.isFinite(value.lastModified)
  );
}

function isCrop(value: unknown): value is Crop | null {
  if (value === null) {
    return true;
  }
  if (!isObject(value)) {
    return false;
  }
  return (
    (value.unit === '%' || value.unit === 'px') &&
    ['x', 'y', 'width', 'height'].every(
      key => typeof value[key] === 'number' && Number.isFinite(value[key])
    )
  );
}

function isNailLength(value: unknown): value is NailLength | null {
  return (
    value === null ||
    value === 'SHORT' ||
    value === 'MEDIUM' ||
    value === 'LONG' ||
    value === 'XL'
  );
}

function decodeRecord(
  value: unknown,
  userId: string,
  now: number,
  ttlMs: number
): UploadDraftSnapshot | null {
  if (!isObject(value)) {
    return null;
  }
  if (
    value.version !== 1 ||
    value.userId !== userId ||
    typeof value.savedAt !== 'number' ||
    !Number.isFinite(value.savedAt) ||
    value.savedAt > now ||
    now - value.savedAt > ttlMs ||
    (value.step !== 1 && value.step !== 2 && value.step !== 3) ||
    (value.step1Sub !== 'select' && value.step1Sub !== 'crop') ||
    !isPersistedFile(value.originalFile) ||
    (value.croppedFile !== null && !isPersistedFile(value.croppedFile)) ||
    !isCrop(value.cropSelection) ||
    !Array.isArray(value.selectedColorIds) ||
    !value.selectedColorIds.every(id => typeof id === 'string') ||
    !Array.isArray(value.selectedTraitIds) ||
    !value.selectedTraitIds.every(id => typeof id === 'string') ||
    !isNailLength(value.selectedLength)
  ) {
    return null;
  }

  const originalFile = restoreFile(value.originalFile);
  const croppedFile =
    value.croppedFile === null ? null : restoreFile(value.croppedFile);
  if (
    originalFile === null ||
    (value.croppedFile !== null && croppedFile === null)
  ) {
    return null;
  }

  return {
    step: value.step,
    step1Sub: value.step1Sub,
    originalFile,
    croppedFile,
    cropSelection: value.cropSelection,
    selectedColorIds: [...value.selectedColorIds],
    selectedTraitIds: [...value.selectedTraitIds],
    selectedLength: value.selectedLength,
  };
}

/**
 * Serializes writes/deletes so a late draft save cannot undo an explicit clear.
 * IndexedDB is best-effort; callers keep their synchronous module-memory copy.
 */
export function createUploadDraftPersistence({
  backend,
  now = Date.now,
  ttlMs = UPLOAD_DRAFT_TTL_MS,
}: UploadDraftPersistenceOptions): UploadDraftPersistence {
  let queue: Promise<void> = Promise.resolve();

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation);
    queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  return {
    read: userId =>
      enqueue(async () => {
        try {
          const record = await backend.get(userId);
          const snapshot = decodeRecord(record, userId, now(), ttlMs);
          if (record !== null && snapshot === null) {
            await backend.delete(userId);
          }
          return snapshot === null ? null : copySnapshot(snapshot);
        } catch {
          return null;
        }
      }),
    write: (userId, snapshot) => {
      // Snapshot synchronously, before the queued operation can observe later mutations.
      const saved = copySnapshot(snapshot);
      return enqueue(async () => {
        try {
          const record: PersistedUploadDraft = {
            version: 1,
            userId,
            savedAt: now(),
            step: saved.step,
            step1Sub: saved.step1Sub,
            originalFile: persistFile(saved.originalFile),
            croppedFile:
              saved.croppedFile === null
                ? null
                : persistFile(saved.croppedFile),
            cropSelection:
              saved.cropSelection === null ? null : { ...saved.cropSelection },
            selectedColorIds: [...saved.selectedColorIds],
            selectedTraitIds: [...saved.selectedTraitIds],
            selectedLength: saved.selectedLength,
          };
          await backend.put(record);
          return true;
        } catch {
          return false;
        }
      });
    },
    delete: userId =>
      enqueue(async () => {
        try {
          await backend.delete(userId);
        } catch {
          // The caller already cleared memory; blocked/private storage must not hang the UI.
        }
      }),
    clearAll: () =>
      enqueue(async () => {
        try {
          await backend.clearAll();
        } catch {
          // Logout remains synchronous even when browser storage is unavailable.
        }
      }),
    clearOtherUsers: userId =>
      enqueue(async () => {
        try {
          await backend.clearOtherUsers(userId);
        } catch {
          // An old account's record is never returned for this identity.
        }
      }),
  };
}

const persistence = createUploadDraftPersistence({
  backend: indexedDbUploadDraftBackend,
});

export function readPersistedUploadDraft(
  userId: string
): Promise<UploadDraftSnapshot | null> {
  return persistence.read(userId);
}

export function writePersistedUploadDraft(
  userId: string,
  snapshot: UploadDraftSnapshot
): Promise<boolean> {
  return persistence.write(userId, snapshot);
}

export function deletePersistedUploadDraft(userId: string): Promise<void> {
  return persistence.delete(userId);
}

export function clearPersistedUploadDrafts(): Promise<void> {
  return persistence.clearAll();
}

export function clearOtherPersistedUploadDrafts(userId: string): Promise<void> {
  return persistence.clearOtherUsers(userId);
}
