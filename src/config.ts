// Public identifiers and app-wide constants. Secrets never live here.

/** Google OAuth Web client id; Settings can override it at runtime. */
export const GOOGLE_CLIENT_ID = '218691396232-e91in46ut3d87ovmm1g3k76ndafb1v1g.apps.googleusercontent.com'

export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
].join(' ')

export const SIDECAR_SUFFIX = '.marginalia.json'

export const NOTES_SUFFIX = '.marginalia-notes.json'

/** Home picture in the root folder; capture group 1 is the slot, absent for the generic picture. */
export const HOME_ART_FILE = /^marginalia-home(?:-(landscape|portrait))?\.(png|jpe?g|webp)$/i

export const DEFAULT_TEXT_MODEL = 'claude-haiku-5-5'
export const DEFAULT_VISION_MODEL = 'claude-opus-5-5'

/** Library re-sync interval while the app is visible. */
export const LIBRARY_SYNC_INTERVAL_MS = 60_000

/** Debounce before a local annotation edit is persisted and queued for upload. */
export const SIDECAR_SAVE_DEBOUNCE_MS = 1_500

/** Renew the Drive token on the next user gesture when less than this remains. */
export const TOKEN_RENEW_MARGIN_MS = 5 * 60_000

/** Cap on locally cached PDF bytes before the least recently opened are evicted. */
export const PDF_CACHE_LIMIT_BYTES = 1024 * 1024 * 1024

/** Longest edge of a page crop sent to Claude. */
export const IMAGE_MAX_EDGE_PX = 2576
