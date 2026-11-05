/**
 * FVKS / FM Meetings connection material after jwt-bearer (parity with FMAH StoredTokens).
 * Persisted encrypted; never returned on public API responses.
 */

export type FvksAcquiredVia = 'token_exchange' | 'manual_oauth' | 'api_key'

export interface FvksTokenSubject {
  id: string
  type: 'user' | 'application'
}

/** Token-endpoint extras that the MCP OAuth SDK drops from its strict schema. */
export interface FvksTokenExtras {
  subject?: FvksTokenSubject
  grantId?: string
}

export interface FvksStoredTokens {
  access_token: string
  token_type?: string
  refresh_token?: string
  scope?: string
  /** unix ms */
  expires_at?: number
  subject?: FvksTokenSubject
  /** FVKS grant id — webhook routing key */
  grant_id?: string
  /**
   * High-water `event.cursor` from push or `list_events` catch-up.
   * Used to resume after FVKS stops retrying (~40 min).
   */
  events_cursor?: string | null
  /** unix ms — connection created / first events subscription; catch-up skips older */
  events_since_ms?: number
  acquired_via: FvksAcquiredVia
  connector_slug: string
  mcp_url: string
  updated_at: number
}

export interface FvksConnectionPublic {
  connector: string
  grant_id: string | null
  subject: FvksTokenSubject | null
  mcp_url: string | null
  expires_at: number | null
  acquired_via: FvksAcquiredVia | null
  connected: boolean
}
