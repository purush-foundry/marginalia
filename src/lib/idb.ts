// IndexedDB key-value helper over the app's object stores, with an in-memory map when IndexedDB is absent.

export type StoreName = 'files' | 'sidecars' | 'notebooks' | 'settings' | 'meta' | 'queue'

const DB_NAME = 'marginalia'
const DB_VERSION = 3
const STORES: readonly StoreName[] = ['files', 'sidecars', 'notebooks', 'settings', 'meta', 'queue']
/** The older notes store, read only to seed `notebooks` on upgrade and otherwise left alone. */
const OLD_NOTES_STORE = 'notes'

let dbPromise: Promise<IDBDatabase> | null = null
const memory = new Map<StoreName, Map<string, unknown>>(STORES.map((s) => [s, new Map()]))

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined'
}

// Copies every record of one store into another inside an upgrade transaction.
function copyStore(tx: IDBTransaction, from: string, to: StoreName): void {
  const keys = tx.objectStore(from).getAllKeys()
  const values = tx.objectStore(from).getAll()
  values.onsuccess = () => {
    const target = tx.objectStore(to)
    keys.result.forEach((key, i) => target.put(values.result[i], key))
  }
}

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      const seedNotebooks = !db.objectStoreNames.contains('notebooks') && db.objectStoreNames.contains(OLD_NOTES_STORE)
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name)
      }
      if (seedNotebooks) copyStore(req.transaction!, OLD_NOTES_STORE, 'notebooks')
    }
    req.onsuccess = () => {
      const db = req.result
      db.onclose = () => {
        dbPromise = null
      }
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    req.onerror = () => {
      dbPromise = null
      reject(req.error)
    }
  })
  return dbPromise
}

// Runs one request in its own transaction and resolves with its result once the transaction commits.
async function run<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  op: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode)
    const req = op(tx.objectStore(store))
    tx.oncomplete = () => resolve(req.result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  if (!hasIndexedDb()) return memory.get(store)!.get(key) as T | undefined
  return (await run(store, 'readonly', (s) => s.get(key))) as T | undefined
}

export async function idbSet(store: StoreName, key: string, value: unknown): Promise<void> {
  if (!hasIndexedDb()) {
    memory.get(store)!.set(key, value)
    return
  }
  await run(store, 'readwrite', (s) => s.put(value, key))
}

export async function idbDel(store: StoreName, key: string): Promise<void> {
  if (!hasIndexedDb()) {
    memory.get(store)!.delete(key)
    return
  }
  await run(store, 'readwrite', (s) => s.delete(key))
}

export async function idbKeys(store: StoreName): Promise<string[]> {
  if (!hasIndexedDb()) return [...memory.get(store)!.keys()]
  return (await run(store, 'readonly', (s) => s.getAllKeys())).map(String)
}

export async function idbGetAll<T>(store: StoreName): Promise<Array<{ key: string; value: T }>> {
  if (!hasIndexedDb()) {
    return [...memory.get(store)!.entries()].map(([key, value]) => ({ key, value: value as T }))
  }
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const keys = tx.objectStore(store).getAllKeys()
    const values = tx.objectStore(store).getAll()
    tx.oncomplete = () =>
      resolve(keys.result.map((key, i) => ({ key: String(key), value: values.result[i] as T })))
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}
