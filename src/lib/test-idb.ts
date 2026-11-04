// Test-only in-memory IndexedDB with versioned upgrades, enough for src/lib/idb.ts.

type Data = Map<string, Map<IDBValidKey, unknown>>

class FakeRequest<T = unknown> {
  result!: T
  error: DOMException | null = null
  transaction: FakeTransaction | null = null
  onsuccess: (() => void) | null = null
  onerror: (() => void) | null = null
  onupgradeneeded: (() => void) | null = null
}

class FakeTransaction {
  oncomplete: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  error: DOMException | null = null
  private pending = 0
  private done = false

  private readonly data: Data

  constructor(data: Data) {
    this.data = data
    this.settle()
  }

  objectStore(name: string): FakeStore {
    const store = this.data.get(name)
    if (!store) throw new DOMException(`No store ${name}`, 'NotFoundError')
    return new FakeStore(store, this)
  }

  request<T>(compute: () => T): FakeRequest<T> {
    const req = new FakeRequest<T>()
    this.pending++
    queueMicrotask(() => {
      req.result = compute()
      req.onsuccess?.()
      this.pending--
      this.settle()
    })
    return req
  }

  private settle(): void {
    setTimeout(() => {
      if (this.pending > 0 || this.done) return
      this.done = true
      this.oncomplete?.()
    })
  }
}

class FakeStore {
  private readonly records: Map<IDBValidKey, unknown>
  private readonly tx: FakeTransaction

  constructor(records: Map<IDBValidKey, unknown>, tx: FakeTransaction) {
    this.records = records
    this.tx = tx
  }

  get(key: IDBValidKey) {
    return this.tx.request(() => structuredClone(this.records.get(key)))
  }

  put(value: unknown, key: IDBValidKey) {
    return this.tx.request(() => {
      this.records.set(key, structuredClone(value))
      return key
    })
  }

  delete(key: IDBValidKey) {
    return this.tx.request(() => {
      this.records.delete(key)
      return undefined
    })
  }

  getAllKeys() {
    return this.tx.request(() => [...this.records.keys()])
  }

  getAll() {
    return this.tx.request(() => [...this.records.values()].map((v) => structuredClone(v)))
  }
}

class FakeDatabase {
  onclose: (() => void) | null = null
  onversionchange: (() => void) | null = null
  readonly objectStoreNames: { contains(name: string): boolean }
  private readonly data: Data

  constructor(data: Data) {
    this.data = data
    this.objectStoreNames = { contains: (name) => data.has(name) }
  }

  createObjectStore(name: string): void {
    this.data.set(name, new Map())
  }

  transaction(): FakeTransaction {
    return new FakeTransaction(this.data)
  }

  close(): void {}
}

/** An IndexedDB factory over in-memory databases that tests can seed and inspect by store. */
export class FakeIndexedDb {
  readonly databases = new Map<string, { version: number; data: Data }>()

  /** Creates a database at a version with the given stores and records, as an older client left it. */
  seed(name: string, version: number, stores: Record<string, Record<string, unknown>>): void {
    const data: Data = new Map(Object.entries(stores).map(([store, records]) => [store, new Map(Object.entries(records))]))
    this.databases.set(name, { version, data })
  }

  /** The records of one store, or undefined when the store does not exist. */
  records(name: string, store: string): Record<string, unknown> | undefined {
    const records = this.databases.get(name)?.data.get(store)
    return records && Object.fromEntries([...records].map(([k, v]) => [String(k), v]))
  }

  open(name: string, version: number): FakeRequest<FakeDatabase> {
    const req = new FakeRequest<FakeDatabase>()
    setTimeout(() => {
      const existing = this.databases.get(name)
      if (existing && existing.version > version) {
        req.error = new DOMException('Requested version is lower than the existing one', 'VersionError')
        req.onerror?.()
        return
      }
      const entry = existing ?? { version: 0, data: new Map() }
      this.databases.set(name, entry)
      req.result = new FakeDatabase(entry.data)
      if (entry.version === version) {
        req.onsuccess?.()
        return
      }
      const tx = new FakeTransaction(entry.data)
      req.transaction = tx
      tx.oncomplete = () => {
        entry.version = version
        req.transaction = null
        req.onsuccess?.()
      }
      req.onupgradeneeded?.()
    })
    return req
  }
}
