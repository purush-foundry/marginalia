// Service worker: precaches the built shell, cache-first for hashed assets, network-first for app-shell navigations; same-origin only.

interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void
}

interface FetchEvent extends ExtendableEvent {
  request: Request
  respondWith(response: Promise<Response>): void
}

interface WorkerScope {
  location: Location
  caches: CacheStorage
  clients: { claim(): Promise<void> }
  skipWaiting(): Promise<void>
  addEventListener(type: 'install' | 'activate', listener: (e: ExtendableEvent) => void): void
  addEventListener(type: 'fetch', listener: (e: FetchEvent) => void): void
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void
}

const sw = self as unknown as WorkerScope

/** Replaced at build time with the list of built files, relative to this worker. */
const PRECACHE = '__PRECACHE_MANIFEST__' as unknown as string[]
const CACHE = 'marginalia-__PRECACHE_VERSION__'
const SCOPE = new URL('./', sw.location.href)
const INDEX = new URL('index.html', SCOPE).href
const CACHE_FIRST = ['assets/', 'pdfjs/'].map((p) => new URL(p, SCOPE).pathname)
const SHELL_PATHS = [SCOPE.pathname, new URL(INDEX).pathname]

sw.addEventListener('install', (e) => {
  e.waitUntil(sw.caches.open(CACHE).then((c) => c.addAll(PRECACHE)))
})

sw.addEventListener('activate', (e) => {
  e.waitUntil(
    sw.caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('marginalia-') && k !== CACHE).map((k) => sw.caches.delete(k))))
      .then(() => sw.clients.claim()),
  )
})

sw.addEventListener('message', (e) => {
  if ((e.data as { type?: string } | null)?.type === 'skip-waiting') void sw.skipWaiting()
})

async function cacheFirst(request: Request): Promise<Response> {
  const hit = await sw.caches.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok) {
    const copy = response.clone()
    void sw.caches.open(CACHE).then((c) => c.put(request, copy))
  }
  return response
}

async function networkFirst(request: Request): Promise<Response> {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const copy = response.clone()
      void sw.caches.open(CACHE).then((c) => c.put(INDEX, copy))
    }
    return response
  } catch (err) {
    const cached = await sw.caches.match(INDEX)
    if (cached) return cached
    throw err
  }
}

// Handles same-origin GETs only; Google and Anthropic requests pass through untouched.
sw.addEventListener('fetch', (e) => {
  const { request } = e
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== SCOPE.origin) return
  if (request.mode === 'navigate') {
    if (SHELL_PATHS.includes(url.pathname)) e.respondWith(networkFirst(request))
  }
  else if (CACHE_FIRST.some((p) => url.pathname.startsWith(p))) e.respondWith(cacheFirst(request))
})
