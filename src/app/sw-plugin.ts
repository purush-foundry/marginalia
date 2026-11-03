// Build plugin: fills the service worker chunk's precache list and cache version from the final bundle.

interface OutputFile {
  type: 'chunk' | 'asset'
  fileName: string
  code?: string
}

export const SW_FILE = 'sw.js'

// Short stable hash of the file list, used as the cache version.
function hashList(files: string[]): string {
  let h = 5381
  for (const ch of files.join('\n')) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0
  return h.toString(36)
}

/** Every built file except the worker and source maps, plus `extra` public files, sorted. */
export function precacheList(bundle: Record<string, OutputFile>, extra: string[] = []): string[] {
  const built = Object.keys(bundle).filter((f) => f !== SW_FILE && !f.endsWith('.map'))
  return [...new Set([...built, ...extra])].sort()
}

/** Vite plugin that rewrites `sw.js` in place during generateBundle. */
export function swPrecache(extra: string[] = []) {
  return {
    name: 'marginalia-sw-precache',
    apply: 'build' as const,
    enforce: 'post' as const,
    generateBundle(_options: unknown, bundle: Record<string, OutputFile>) {
      const sw = bundle[SW_FILE]
      if (!sw || sw.type !== 'chunk' || !sw.code?.includes('__PRECACHE_MANIFEST__')) {
        throw new Error(`${SW_FILE} with a __PRECACHE_MANIFEST__ placeholder is missing from the bundle`)
      }
      const files = precacheList(bundle, extra)
      sw.code = sw.code
        .replace(/(["'`])__PRECACHE_MANIFEST__\1/g, JSON.stringify(files))
        .replaceAll('__PRECACHE_VERSION__', hashList(files))
    },
  }
}
