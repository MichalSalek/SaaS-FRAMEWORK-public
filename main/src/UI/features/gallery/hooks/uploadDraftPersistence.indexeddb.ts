import type {
  PersistedUploadDraft,
  UploadDraftPersistenceBackend,
} from './uploadDraftPersistence';

const DATABASE_NAME = 'nailfolio-upload-drafts';
const DATABASE_VERSION = 1;
const STORE_NAME = 'drafts';
const OPEN_TIMEOUT_MS = 1_500;
const TRANSACTION_TIMEOUT_MS = 8_000;

let cachedDatabase: IDBDatabase | null = null;
let openingDatabase: Promise<IDBDatabase | null> | null = null;

function resetCachedDatabase(database?: IDBDatabase): void {
  if (database === undefined || cachedDatabase === database) {
    cachedDatabase = null;
    openingDatabase = null;
  }
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (cachedDatabase !== null) {
    return Promise.resolve(cachedDatabase);
  }
  if (openingDatabase !== null) {
    return openingDatabase;
  }

  let factory: IDBFactory | undefined;
  try {
    factory = globalThis.indexedDB;
  } catch {
    return Promise.resolve(null);
  }
  if (factory === undefined) {
    return Promise.resolve(null);
  }

  let opening: Promise<IDBDatabase | null> | null = null;
  let settled = false;
  const promise = new Promise<IDBDatabase | null>(resolve => {
    const timeout = setTimeout(() => finish(null), OPEN_TIMEOUT_MS);
    const finish = (database: IDBDatabase | null) => {
      if (settled) {
        if (database !== null) {
          database.close();
        }
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (database !== null) {
        cachedDatabase = database;
      }
      if (openingDatabase === opening) {
        openingDatabase = null;
      }
      resolve(database);
    };

    try {
      const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'userId' });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          resetCachedDatabase(database);
        };
        database.onclose = () => resetCachedDatabase(database);
        finish(database);
      };
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
    } catch {
      finish(null);
    }
  });
  opening = promise;
  if (!settled) {
    openingDatabase = promise;
  }
  return promise;
}

async function runDatabaseTransaction<T>(
  mode: IDBTransactionMode,
  createRequest: (store: IDBObjectStore) => IDBRequest<T>,
  onRequestSuccess?: (request: IDBRequest<T>) => void
): Promise<T | undefined> {
  const database = await openDatabase();
  if (database === null) {
    return undefined;
  }

  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = createRequest(transaction.objectStore(STORE_NAME));
      let result: T | undefined;
      let settled = false;
      const timeout = setTimeout(() => {
        fail(new Error('IndexedDB transaction timed out'));
      }, TRANSACTION_TIMEOUT_MS);
      const succeed = (value: T) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };
      const fail = (error: DOMException | Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        try {
          transaction.abort();
        } catch {
          // The transaction may already be complete.
        }
        reject(error);
      };
      request.onsuccess = () => {
        result = request.result;
        try {
          onRequestSuccess?.(request);
        } catch (error) {
          fail(
            error instanceof Error
              ? error
              : new Error('IndexedDB request callback failed')
          );
        }
      };
      request.onerror = () =>
        fail(request.error ?? new Error('IndexedDB request failed'));
      transaction.oncomplete = () => succeed(result as T);
      transaction.onerror = () =>
        fail(transaction.error ?? new Error('IndexedDB transaction failed'));
      transaction.onabort = () =>
        fail(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
  } catch (error) {
    resetCachedDatabase(database);
    throw error;
  }
}

export const indexedDbUploadDraftBackend: UploadDraftPersistenceBackend = {
  async get(userId) {
    const record = await runDatabaseTransaction('readonly', store =>
      store.get(userId)
    );
    return record ?? null;
  },
  async put(record: PersistedUploadDraft) {
    const key = await runDatabaseTransaction('readwrite', store =>
      store.put(record)
    );
    if (key === undefined) {
      throw new Error('IndexedDB is unavailable');
    }
  },
  async delete(userId) {
    await runDatabaseTransaction('readwrite', store => store.delete(userId));
  },
  async clearAll() {
    await runDatabaseTransaction('readwrite', store => store.clear());
  },
  async clearOtherUsers(userId) {
    await runDatabaseTransaction(
      'readwrite',
      store => store.openCursor(),
      request => {
        const cursor = request.result;
        if (cursor === null) {
          return;
        }
        if (cursor.primaryKey !== userId) {
          cursor.delete();
        }
        cursor.continue();
      }
    );
  },
};
