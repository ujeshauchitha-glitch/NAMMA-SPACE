/**
 * T10 — `src/lib/storage/` unit suite.
 *
 * Runs in node against a hand-rolled in-memory IDBFactory stand-in that
 * implements exactly the surface `idb@8` touches (open/upgrade flow, request
 * + transaction events, addEventListener plumbing, the global constructors
 * idb uses for `instanceof` wrapping). No `fake-indexeddb` dependency — per
 * spec the stub lives here.
 *
 * Proves:
 *  - typed put/get/list/delete round-trips for staged images and kv
 *  - deterministic listing order and idempotent delete
 *  - QuotaExceededError → typed honest StorageError with nothing written
 *  - >25 MB guard rejects before any write
 *  - no IndexedDB on the platform → typed honest 'unavailable' error
 *  - injected factories really isolate databases
 *  - WorkspacePersistence strips runtime-only fields on save and reports
 *    quota failures through onError without throwing
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_RAW_IMAGE_BYTES,
  StorageError,
  createIdbPersistence,
  openStorage,
  type StorageHandle,
  type StoredImageRecord,
} from '../src/lib/storage';
import { initialWorkspaceState } from '../src/state/reducer';
import type { WorkspaceState } from '../src/state/types';

/* ========================================================================== *
 * Hand-rolled in-memory IndexedDB stand-in.
 *
 * Implements only what idb@8 exercises:
 *  - IDBOpenDBRequest open flow: upgradeneeded (sync callback window) → success
 *  - IDBRequest success/error events; IDBTransaction complete/error events
 *  - IDBDatabase.transaction/createObjectStore/objectStoreNames.contains
 *  - IDBObjectStore.put/get/getAll/delete/count/clear with out-of-line keys
 *  - the global constructors idb references for instanceof checks, including
 *    IDBCursor.prototype advance/continue/continuePrimaryKey
 * Values are stored by reference (no structured clone) — the browser-side
 * clone semantics are covered by the real-IDB e2e (T24).
 * ========================================================================== */

type StubEvent = {
  type: string;
  target: unknown;
  oldVersion?: number;
  newVersion?: number;
};

type StubListener = (event: StubEvent) => void;

class StubEventTarget {
  private readonly listeners = new Map<string, Set<StubListener>>();

  addEventListener(type: string, listener: StubListener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: StubListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  /** Dispatch synchronously over a copy so listeners may unbind mid-event. */
  protected emit(type: string, event: StubEvent): void {
    for (const listener of Array.from(this.listeners.get(type) ?? [])) listener(event);
  }
}

type DbProfile = {
  version: number;
  stores: Map<string, Map<string, unknown>>;
  /** Test hook: consumed by exactly one subsequent put. */
  failNextPut: DOMException | null;
};

class StoreNameList extends Array<string> {
  contains(name: string): boolean {
    return this.includes(name);
  }
}

class StubIDBRequest<T = unknown> extends StubEventTarget {
  result: T | undefined = undefined;
  error: DOMException | null = null;
  transaction: StubIDBTransaction | null = null;
  readyState: 'pending' | 'done' = 'pending';

  succeed(result: T, tx: StubIDBTransaction | null): void {
    this.result = result;
    this.readyState = 'done';
    this.transaction = tx;
    this.emit('success', { type: 'success', target: this });
    tx?.markSuccess();
  }

  fail(error: DOMException, tx: StubIDBTransaction | null): void {
    this.error = error;
    this.readyState = 'done';
    this.emit('error', { type: 'error', target: this });
    tx?.markFailure(error);
  }
}

class StubIDBOpenDBRequest extends StubIDBRequest<StubIDBDatabase> {
  runUpgrade(oldVersion: number, newVersion: number): void {
    this.emit('upgradeneeded', { type: 'upgradeneeded', target: this, oldVersion, newVersion });
  }
}

class StubIDBTransaction extends StubEventTarget {
  readonly objectStoreNames: StoreNameList;
  readonly mode: string;
  error: DOMException | null = null;
  private pending = 0;
  private settled = false;

  constructor(
    private readonly profile: DbProfile,
    names: readonly string[],
    mode: string,
  ) {
    super();
    this.mode = mode;
    this.objectStoreNames = new StoreNameList();
    for (const name of names) this.objectStoreNames.push(name);
  }

  objectStore(name: string): StubIDBObjectStore {
    const data = this.profile.stores.get(name);
    if (!data) throw new DOMException(`Store "${name}" does not exist.`, 'NotFoundError');
    return new StubIDBObjectStore(name, data, this.profile, this);
  }

  enqueue(): void {
    this.pending += 1;
  }

  markSuccess(): void {
    this.pending -= 1;
    if (this.pending > 0 || this.settled) return;
    // Real IDB commits when the event loop turns with no pending requests.
    setTimeout(() => {
      if (this.settled || this.pending > 0) return;
      this.settled = true;
      this.emit('complete', { type: 'complete', target: this });
    }, 0);
  }

  markFailure(error: DOMException): void {
    if (this.settled) return;
    this.settled = true;
    this.error = error;
    this.emit('error', { type: 'error', target: this });
  }

  finishUpgrade(): void {
    if (this.settled) return;
    this.settled = true;
    this.emit('complete', { type: 'complete', target: this });
  }
}

class StubIDBObjectStore extends StubEventTarget {
  constructor(
    private readonly storeName: string,
    private readonly data: Map<string, unknown>,
    private readonly profile: DbProfile,
    private readonly tx: StubIDBTransaction,
  ) {
    super();
  }

  put(value: unknown, key?: string): StubIDBRequest<string> {
    const request = new StubIDBRequest<string>();
    this.tx.enqueue();
    queueMicrotask(() => {
      const injected = this.profile.failNextPut;
      if (injected) {
        this.profile.failNextPut = null;
        request.fail(injected, this.tx);
        return;
      }
      if (key === undefined) {
        request.fail(
          new DOMException(`No key supplied for store "${this.storeName}".`, 'DataError'),
          this.tx,
        );
        return;
      }
      this.data.set(key, value);
      request.succeed(key, this.tx);
    });
    return request;
  }

  get(key: string): StubIDBRequest<unknown> {
    const request = new StubIDBRequest<unknown>();
    this.tx.enqueue();
    queueMicrotask(() => request.succeed(this.data.get(key), this.tx));
    return request;
  }

  getAll(): StubIDBRequest<unknown[]> {
    const request = new StubIDBRequest<unknown[]>();
    this.tx.enqueue();
    queueMicrotask(() => request.succeed(Array.from(this.data.values()), this.tx));
    return request;
  }

  delete(key: string): StubIDBRequest<undefined> {
    const request = new StubIDBRequest<undefined>();
    this.tx.enqueue();
    queueMicrotask(() => {
      this.data.delete(key);
      request.succeed(undefined, this.tx);
    });
    return request;
  }

  count(): StubIDBRequest<number> {
    const request = new StubIDBRequest<number>();
    this.tx.enqueue();
    queueMicrotask(() => request.succeed(this.data.size, this.tx));
    return request;
  }

  clear(): StubIDBRequest<undefined> {
    const request = new StubIDBRequest<undefined>();
    this.tx.enqueue();
    queueMicrotask(() => {
      this.data.clear();
      request.succeed(undefined, this.tx);
    });
    return request;
  }
}

class StubIDBDatabase extends StubEventTarget {
  readonly name: string;
  private upgradeTx: StubIDBTransaction | null = null;

  constructor(
    private readonly profile: DbProfile,
    name: string,
  ) {
    super();
    this.name = name;
  }

  get objectStoreNames(): StoreNameList {
    const list = new StoreNameList();
    for (const key of this.profile.stores.keys()) list.push(key);
    return list;
  }

  createObjectStore(name: string): StubIDBObjectStore {
    if (!this.upgradeTx) {
      throw new DOMException('Not in a versionchange transaction.', 'InvalidStateError');
    }
    if (this.profile.stores.has(name)) {
      throw new DOMException(`Store "${name}" already exists.`, 'ConstraintError');
    }
    const data = new Map<string, unknown>();
    this.profile.stores.set(name, data);
    return new StubIDBObjectStore(name, data, this.profile, this.upgradeTx);
  }

  transaction(storeNames: string | readonly string[], mode = 'readonly'): StubIDBTransaction {
    const names = typeof storeNames === 'string' ? [storeNames] : [...storeNames];
    for (const name of names) {
      if (!this.profile.stores.has(name)) {
        throw new DOMException(`Store "${name}" does not exist.`, 'NotFoundError');
      }
    }
    return new StubIDBTransaction(this.profile, names, mode);
  }

  objectStore(name: string): StubIDBObjectStore {
    return this.transaction(name, 'readonly').objectStore(name);
  }

  close(): void {}

  beginUpgrade(tx: StubIDBTransaction): void {
    this.upgradeTx = tx;
  }

  endUpgrade(): void {
    this.upgradeTx = null;
  }
}

/** idb references these for instanceof checks and its cursor method table. */
class StubIDBIndex extends StubEventTarget {}
class StubIDBCursor {
  advance(): void {}
  continue(): void {}
  continuePrimaryKey(): void {}
}

Object.assign(globalThis, {
  IDBRequest: StubIDBRequest,
  IDBOpenDBRequest: StubIDBOpenDBRequest,
  IDBDatabase: StubIDBDatabase,
  IDBObjectStore: StubIDBObjectStore,
  IDBTransaction: StubIDBTransaction,
  IDBIndex: StubIDBIndex,
  IDBCursor: StubIDBCursor,
});

type MemoryIdb = {
  factory: IDBFactory;
  failNextPut: (error: DOMException) => void;
};

/** One factory = one isolated "browser profile". */
function createMemoryIdb(): MemoryIdb {
  const profiles = new Map<string, DbProfile>();

  const open = (name: string, version = 1): StubIDBOpenDBRequest => {
    const request = new StubIDBOpenDBRequest();
    queueMicrotask(() => {
      const existing = profiles.get(name);
      const oldVersion = existing?.version ?? 0;
      if (version < oldVersion) {
        request.fail(
          new DOMException(
            `The requested version (${version}) is less than the existing version (${oldVersion}).`,
            'VersionError',
          ),
          null,
        );
        return;
      }
      const profile: DbProfile = existing ?? { version: 0, stores: new Map(), failNextPut: null };
      profiles.set(name, profile);
      const db = new StubIDBDatabase(profile, name);
      const upgradeTx = new StubIDBTransaction(profile, [], 'versionchange');
      const upgrading = version > oldVersion;
      request.transaction = upgradeTx;
      request.result = db;
      if (upgrading) {
        profile.version = version;
        db.beginUpgrade(upgradeTx);
        request.runUpgrade(oldVersion, version);
        queueMicrotask(() => {
          db.endUpgrade();
          upgradeTx.finishUpgrade();
          request.succeed(db, upgradeTx);
        });
      } else {
        request.succeed(db, upgradeTx);
      }
    });
    return request;
  };

  return {
    factory: { open } as unknown as IDBFactory,
    failNextPut: (error: DOMException) => {
      const profile = [...profiles.values()].at(-1);
      if (!profile) throw new Error('failNextPut called before any database was opened.');
      profile.failNextPut = error;
    },
  };
}

/* ========================================================================== *
 * Tests
 * ========================================================================== */

function imageRecord(id: string, overrides: Partial<StoredImageRecord> = {}): StoredImageRecord {
  return {
    id,
    blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' }),
    meta: { width: 64, height: 48, bytes: 4, sha256: 'a'.repeat(64), source: 'operator' },
    stagedAt: 1,
    ...overrides,
  };
}

async function blobBytes(blob: Blob): Promise<number[]> {
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

let idb: MemoryIdb;
let storage: StorageHandle;

beforeEach(async () => {
  idb = createMemoryIdb();
  storage = await openStorage({ factory: idb.factory });
});

describe('storage: staged images', () => {
  it('putImage → getImage round-trips bytes and metadata', async () => {
    const record = imageRecord('im-1');
    await storage.putImage(record);

    const loaded = await storage.getImage('im-1');
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe('im-1');
    expect(loaded?.meta).toEqual(record.meta);
    expect(loaded?.stagedAt).toBe(1);
    expect(await blobBytes(loaded!.blob)).toEqual([0xff, 0xd8, 0xff, 0xe0]);
  });

  it('getImage returns null for an unknown id', async () => {
    expect(await storage.getImage('missing')).toBeNull();
  });

  it('listImages returns every record in deterministic staging order', async () => {
    await storage.putImage(imageRecord('im-late', { stagedAt: 30 }));
    await storage.putImage(imageRecord('im-early', { stagedAt: 10 }));
    await storage.putImage(imageRecord('im-mid', { stagedAt: 20 }));

    const listed = await storage.listImages();
    expect(listed.map((image) => image.id)).toEqual(['im-early', 'im-mid', 'im-late']);

    await storage.deleteImage('im-mid');
    expect((await storage.listImages()).map((image) => image.id)).toEqual(['im-early', 'im-late']);
  });

  it('deleteImage removes the record and is idempotent', async () => {
    await storage.putImage(imageRecord('im-1'));
    await storage.deleteImage('im-1');
    expect(await storage.getImage('im-1')).toBeNull();
    await expect(storage.deleteImage('im-1')).resolves.toBeUndefined();
  });

  it('listImages on an empty store resolves to an empty list', async () => {
    expect(await storage.listImages()).toEqual([]);
  });
});

describe('storage: kv', () => {
  it('putKv → getKv round-trips structured values; unknown key → null', async () => {
    const value = { rooms: [{ id: 'rm-1', name: 'Lobby' }], seq: 3, nested: { ok: true } };
    await storage.putKv('workspace-snapshot.v1', value);
    expect(await storage.getKv('workspace-snapshot.v1')).toEqual(value);
    expect(await storage.getKv('never-written')).toBeNull();
  });
});

describe('storage: honest failure mapping', () => {
  it('maps QuotaExceededError to a typed honest error and writes nothing', async () => {
    idb.failNextPut(new DOMException('The quota has been exceeded.', 'QuotaExceededError'));

    const failure = await storage.putImage(imageRecord('im-doomed')).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(StorageError);
    expect((failure as StorageError).code).toBe('quota-exceeded');
    expect((failure as StorageError).message).toMatch(/storage is full/i);
    expect((failure as StorageError).message).toMatch(/delete staged images/i);
    expect(await storage.getImage('im-doomed')).toBeNull();
  });

  it('rejects images larger than 25 MB before any write', async () => {
    const oversized = imageRecord('im-huge', {
      blob: new Blob([new Uint8Array(MAX_RAW_IMAGE_BYTES + 1)]),
    });

    const failure = await storage.putImage(oversized).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(StorageError);
    expect((failure as StorageError).code).toBe('payload-too-large');
    expect((failure as StorageError).message).toMatch(/25 MB or smaller/);
    expect(await storage.getImage('im-huge')).toBeNull();
    expect(await storage.listImages()).toEqual([]);
  });

  it('reports an honest unavailable error when the platform has no IndexedDB', async () => {
    await expect(openStorage()).rejects.toMatchObject({
      name: 'StorageError',
      code: 'unavailable',
    });
  });
});

describe('storage: injectable factory', () => {
  it('keeps databases of two injected factories isolated', async () => {
    await storage.putImage(imageRecord('im-a'));

    const other = createMemoryIdb();
    const otherStorage = await openStorage({ factory: other.factory });

    expect((await otherStorage.listImages()).map((image) => image.id)).toEqual([]);
    expect(await otherStorage.getImage('im-a')).toBeNull();
    expect((await storage.listImages()).map((image) => image.id)).toEqual(['im-a']);
    otherStorage.close();
  });
});

describe('WorkspacePersistence over IndexedDB (T10)', () => {
  it('saves a stripped snapshot and restores it', async () => {
    const dirty: WorkspaceState = {
      ...(structuredClone(initialWorkspaceState) as WorkspaceState),
      stagedImages: [
        {
          seq: 1,
          id: 'im-1',
          viewGroupId: null,
          objectUrl: 'blob:https://local.test/staged-1',
          meta: { width: 64, height: 48, bytes: 4, sha256: 'b'.repeat(64), source: 'operator' },
          stagedAt: 10,
        },
      ],
      pairing: { state: 'LIVE', updatedAt: 7 },
      toasts: [{ id: 't-1', tone: 'info', title: 'staged' }],
    };

    const persistence = createIdbPersistence(storage);
    await persistence.save(dirty);
    const loaded = await persistence.load();

    expect(loaded).not.toBeNull();
    expect(loaded?.stagedImages[0].objectUrl).toBe('');
    expect(loaded?.stagedImages[0].meta.sha256).toBe('b'.repeat(64));
    expect(loaded?.pairing.state).toBe('IDLE');
    expect(loaded?.toasts).toEqual([]);
    // The runtime state object is never mutated by saving.
    expect(dirty.stagedImages[0].objectUrl).toBe('blob:https://local.test/staged-1');
  });

  it('reports quota failures through onError and save still resolves', async () => {
    const reported: StorageError[] = [];
    const persistence = createIdbPersistence(storage, {
      onError: (error) => reported.push(error),
    });

    idb.failNextPut(new DOMException('quota', 'QuotaExceededError'));
    await expect(persistence.save(initialWorkspaceState)).resolves.toBeUndefined();

    expect(reported).toHaveLength(1);
    expect(reported[0]).toBeInstanceOf(StorageError);
    expect(reported[0].code).toBe('quota-exceeded');
    expect(await persistence.load()).toBeNull();
  });
});
