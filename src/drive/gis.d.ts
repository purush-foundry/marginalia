// Minimal ambient types for the Google Identity Services token model used by auth.ts.

interface GisTokenResponse {
  access_token?: string
  expires_in?: number | string
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
}

interface GisClientConfigError {
  type: 'popup_failed_to_open' | 'popup_closed' | 'unknown'
  message?: string
}

interface GisTokenClientConfig {
  client_id: string
  scope: string
  prompt?: string
  callback: (response: GisTokenResponse) => void
  error_callback?: (error: GisClientConfigError) => void
}

interface GisTokenClient {
  requestAccessToken(override?: { prompt?: string }): void
}

interface GisOauth2 {
  initTokenClient(config: GisTokenClientConfig): GisTokenClient
  revoke(accessToken: string, done?: () => void): void
}

interface Window {
  google?: { accounts?: { oauth2?: GisOauth2 } }
}
