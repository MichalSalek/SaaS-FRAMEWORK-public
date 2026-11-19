import { readUploadDraftMemory } from './hooks/uploadDraftMemory';
import { readPersistedUploadDraft } from './hooks/uploadDraftPersistence';

/** Public feature query: callers learn availability, never the stored file. */
export async function hasUploadDraftForUser(userId: string): Promise<boolean> {
  return (
    readUploadDraftMemory(userId) !== null ||
    (await readPersistedUploadDraft(userId)) !== null
  );
}
