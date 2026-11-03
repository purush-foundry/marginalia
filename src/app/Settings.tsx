// Settings: Google client id and Drive session, Claude key and models, reading switches, cache, version.
import { useEffect, useRef, useState } from 'preact/hooks'
import { checkApiKey } from '../ai/claude'
import { authError, authState, connect, connectWithRedirect, initAuth, signOut } from '../drive/auth'
import { clearPdfCache, library, pdfCacheBytes, syncLibrary } from '../drive/library'
import { Icon } from './icons'
import { applyUpdate, buildId, updateReady } from './pwa'
import { saveSettings, settings, type AppSettings } from './settings'
import { authReady, choosingRoot, settingsOpen } from './ui'

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** Runs Google sign-in from a click and syncs once connected; returns an error message or null. */
export async function connectDrive(): Promise<string | null> {
  try {
    await connect()
    void syncLibrary()
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/** Link that signs in through Google's redirect flow, for when the sign-in popup never returns. */
export function RedirectSignIn() {
  return (
    <button type="button" class="mg-link-btn" onClick={connectWithRedirect}>
      Sign in with a redirect instead
    </button>
  )
}

function Toggle(props: { label: string; hint?: string; field: keyof AppSettings }) {
  const on = Boolean(settings.value[props.field])
  return (
    <label class="mg-toggle">
      <span>
        {props.label}
        {props.hint && <small>{props.hint}</small>}
      </span>
      <input type="checkbox" checked={on} onChange={() => void saveSettings({ [props.field]: !on })} />
    </label>
  )
}

function ClientIdField() {
  const [draft, setDraft] = useState(settings.value.googleClientId)
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true)
    const id = draft.trim()
    await saveSettings({ googleClientId: id })
    authReady.value = false
    await initAuth(id)
    authReady.value = true
    setSaving(false)
  }
  return (
    <div class="mg-field">
      <label for="mg-client-id">Google OAuth client id</label>
      <div class="mg-inline">
        <input
          id="mg-client-id"
          type="text"
          autocomplete="off"
          spellcheck={false}
          placeholder="1234-abc.apps.googleusercontent.com"
          value={draft}
          onInput={(e) => setDraft(e.currentTarget.value)}
        />
        <button
          type="button"
          class="btn primary"
          disabled={saving || !draft.trim() || draft.trim() === settings.value.googleClientId}
          onClick={() => void save()}
        >
          Save
        </button>
      </div>
    </div>
  )
}

function DriveSection() {
  const [error, setError] = useState<string | null>(null)
  const status = authState.value.status
  const label = status === 'ok' ? 'Connected' : status === 'expired' ? 'Session expired' : 'Not connected'
  return (
    <section>
      <h2>Google Drive</h2>
      <ClientIdField />
      <p class="mg-muted">
        {label}
        {library.value && ` · Library: ${library.value.rootName}`}
      </p>
      {(error ?? authError.value) && <p class="mg-error">{error ?? authError.value}</p>}
      <div class="mg-actions">
        {status !== 'ok' && settings.value.googleClientId && authReady.value && (
          <>
            <button type="button" class="btn primary" onClick={() => void connectDrive().then(setError)}>
              {status === 'expired' ? 'Reconnect Drive' : 'Connect Google Drive'}
            </button>
            <RedirectSignIn />
          </>
        )}
        {status === 'ok' && (
          <button
            type="button"
            class="btn"
            onClick={() => {
              choosingRoot.value = true
              settingsOpen.value = false
            }}
          >
            Change root folder
          </button>
        )}
        {status !== 'signed-out' && (
          <button type="button" class="btn" onClick={() => void signOut()}>
            Sign out
          </button>
        )}
      </div>
    </section>
  )
}

// Attributes that keep password managers and autofill away from the API key field.
const SECRET_FIELD_ATTRS = {
  autocomplete: 'off',
  autocapitalize: 'off',
  autocorrect: 'off',
  inputmode: 'text',
  'data-1p-ignore': '',
  'data-lpignore': 'true',
} as const

function ClaudeSection() {
  const field = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(settings.value.anthropicApiKey)
  const [check, setCheck] = useState<{ busy: boolean; message?: string; ok?: boolean }>({ busy: false })
  const saved = settings.value.anthropicApiKey

  // Writes the uncontrolled field and the draft together.
  const setKey = (value: string) => {
    if (field.current) field.current.value = value
    setDraft(value)
  }

  const paste = () => {
    const read = navigator.clipboard?.readText ? navigator.clipboard.readText() : Promise.reject(new Error('no clipboard'))
    read.then(
      (text) => {
        const key = text.trim()
        setKey(key)
        setCheck({ busy: false })
        void saveSettings({ anthropicApiKey: key })
      },
      () => setCheck({ busy: false, ok: false, message: 'Clipboard access denied — paste manually' }),
    )
  }

  const test = async () => {
    const key = (field.current?.value ?? draft).trim()
    setCheck({ busy: true })
    const res = await checkApiKey(key, settings.value.textModel)
    if (res.ok) await saveSettings({ anthropicApiKey: key })
    setCheck({ busy: false, ok: res.ok, message: res.ok ? 'Key works and is saved on this device.' : res.message })
  }

  return (
    <section>
      <h2>Claude</h2>
      <div class="mg-field">
        <label for="mg-api-key">Anthropic API key</label>
        <input
          ref={field}
          id="mg-api-key"
          name="marginalia-api-key"
          type="text"
          class="mg-secret"
          spellcheck={false}
          placeholder="sk-ant-…"
          defaultValue={saved}
          {...SECRET_FIELD_ATTRS}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onChange={(e) => void saveSettings({ anthropicApiKey: e.currentTarget.value.trim() })}
        />
      </div>
      {check.message && <p class={check.ok ? 'mg-muted' : 'mg-error'}>{check.message}</p>}
      <div class="mg-actions">
        <button type="button" class="btn" disabled={check.busy || !draft.trim()} onClick={() => void test()}>
          {check.busy ? 'Testing…' : 'Test key'}
        </button>
        <button type="button" class="btn" onClick={paste}>
          Paste
        </button>
        <button
          type="button"
          class="btn"
          disabled={!saved && !draft}
          onClick={() => {
            setKey('')
            setCheck({ busy: false })
            void saveSettings({ anthropicApiKey: '' })
          }}
        >
          Forget
        </button>
      </div>
      <div class="mg-field">
        <label for="mg-fast">Fast model</label>
        <input
          id="mg-fast"
          type="text"
          spellcheck={false}
          value={settings.value.textModel}
          onChange={(e) => void saveSettings({ textModel: e.currentTarget.value.trim() })}
        />
      </div>
      <div class="mg-field">
        <label for="mg-smart">Smart model (figures, equations)</label>
        <input
          id="mg-smart"
          type="text"
          spellcheck={false}
          value={settings.value.visionModel}
          onChange={(e) => void saveSettings({ visionModel: e.currentTarget.value.trim() })}
        />
      </div>
    </section>
  )
}

function CacheSection() {
  const [bytes, setBytes] = useState<number | null>(null)
  const refresh = () => void pdfCacheBytes().then(setBytes, () => setBytes(null))
  useEffect(refresh, [])
  return (
    <section>
      <h2>Storage</h2>
      <p class="mg-muted">Cached PDFs: {bytes === null ? '…' : formatBytes(bytes)}</p>
      <div class="mg-actions">
        <button type="button" class="btn" disabled={!bytes} onClick={() => void clearPdfCache().then(refresh)}>
          Clear cached PDFs
        </button>
      </div>
    </section>
  )
}

/** Full settings page; `onboarding` shows only the Google client id step. */
export function Settings(props: { onboarding?: boolean }) {
  if (props.onboarding) {
    return (
      <div class="mg-settings">
        <section>
          <h2>Set up Google Drive</h2>
          <p class="mg-muted">
            Paste the OAuth Web client id from your Google Cloud project (see the README for the one-time setup).
          </p>
          <ClientIdField />
        </section>
      </div>
    )
  }
  return (
    <div class="mg-settings">
      <header class="mg-sheet-head">
        <h1>Settings</h1>
        <button type="button" class="btn" aria-label="Close settings" onClick={() => (settingsOpen.value = false)}>
          <Icon name="close" />
        </button>
      </header>
      <DriveSection />
      <ClaudeSection />
      <section>
        <h2>Reading</h2>
        <Toggle label="Night mode" field="nightMode" />
        <Toggle label="Invert images in night mode" field="invertImages" />
        <Toggle label="Finger draws" hint="A finger draws like the Pencil instead of scrolling." field="fingerDraws" />
      </section>
      <CacheSection />
      <section>
        <h2>About</h2>
        <p class="mg-muted">
          Marginalia · build {buildId()} ·{' '}
          <a href={`${import.meta.env.BASE_URL}privacy.html`} target="_blank" rel="noopener noreferrer">
            Privacy
          </a>
        </p>
        {updateReady.value && (
          <button type="button" class="btn primary" onClick={applyUpdate}>
            Update available — Reload
          </button>
        )}
      </section>
    </div>
  )
}
