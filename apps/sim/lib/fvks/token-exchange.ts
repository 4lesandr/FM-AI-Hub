import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import type { FvksStoredTokens, FvksTokenExtras, FvksTokenSubject } from '@/lib/fvks/types'

const logger = createLogger('FvksTokenExchange')

export const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange'
export const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer'
export const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token'

/** Personal env key — system reserved; do not surface as a workflow secret. */
export const FVKS_CONNECTION_ENV_KEY = '__SIM_FVKS_CONNECTION__'

const DEFAULT_TIMEOUT_MS = 10_000

export function parseIdpAudiences(
  raw: string | undefined = env.HUB_IDP_AUDIENCES
): Map<string, string> {
  const map = new Map<string, string>()
  for (const pair of (raw ?? '').split(',')) {
    const [slug, audience] = pair.split('=').map((s) => s.trim())
    if (slug && audience) map.set(slug, audience)
  }
  return map
}

export function resolveOidcIssuer(
  issuer: string | undefined = env.HUB_OIDC_ISSUER ?? env.SSO_ISSUER
): string | null {
  const trimmed = issuer?.trim().replace(/\/$/, '')
  return trimmed || null
}

export function resolveOidcProviderId(
  providerId: string | undefined = env.HUB_OIDC_PROVIDER_ID ?? env.SSO_PROVIDER_ID
): string {
  return (providerId?.trim() || 'keycloak').toLowerCase()
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function parseTokenSubject(value: unknown): FvksTokenSubject | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as { id?: unknown; type?: unknown }
  if (typeof record.id !== 'string' || !record.id) return undefined
  return {
    id: record.id,
    type: record.type === 'application' ? 'application' : 'user',
  }
}

/**
 * Prefer token-endpoint extras; fall back to unverified JWT claims (ids only).
 */
export function extrasOfAccessToken(
  accessToken: string | undefined,
  body?: Record<string, unknown>
): FvksTokenExtras {
  const fromBody: FvksTokenExtras = {
    subject: parseTokenSubject(body?.subject),
    grantId: nonEmpty(body?.grant_id),
  }
  if (!accessToken) return fromBody

  let fromJwt: FvksTokenExtras = {}
  const parts = accessToken.split('.')
  if (parts.length === 3) {
    try {
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
        sub?: unknown
        sub_type?: unknown
        grant_id?: unknown
      }
      fromJwt = {
        subject: parseTokenSubject({ id: claims.sub, type: claims.sub_type }),
        grantId: nonEmpty(claims.grant_id),
      }
    } catch {
      /* not a JWT */
    }
  }

  return {
    subject: fromBody.subject ?? fromJwt.subject,
    grantId: fromBody.grantId ?? fromJwt.grantId,
  }
}

async function postForm(
  url: string,
  form: Record<string, string>,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    const detail =
      `${String(body.error ?? response.status)} ${String(body.error_description ?? '')}`.trim()
    throw new Error(`${new URL(url).host}: ${detail}`)
  }
  return body
}

/**
 * RFC 8693 at Keycloak: human token addressed to the app audience, requested by the hub client.
 */
export async function exchangeSubjectToken(params: {
  subjectToken: string
  audience: string
  issuer?: string | null
  clientId?: string
  clientSecret?: string
}): Promise<string> {
  const issuer = resolveOidcIssuer(params.issuer ?? undefined)
  if (!issuer) throw new Error('HUB_OIDC_ISSUER (or SSO_ISSUER) is not configured')

  const clientId = params.clientId ?? env.HUB_OIDC_CLIENT_ID ?? env.SSO_OIDC_CLIENT_ID
  const clientSecret =
    params.clientSecret ?? env.HUB_OIDC_CLIENT_SECRET ?? env.SSO_OIDC_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('HUB_OIDC_CLIENT_ID/SECRET (or SSO_OIDC_*) are not configured')
  }

  const body = await postForm(`${issuer}/protocol/openid-connect/token`, {
    grant_type: TOKEN_EXCHANGE_GRANT,
    client_id: clientId,
    client_secret: clientSecret,
    subject_token: params.subjectToken,
    audience: params.audience,
    requested_token_type: ACCESS_TOKEN_TYPE,
  })

  const assertion = nonEmpty(body.access_token)
  if (!assertion) throw new Error('Keycloak token-exchange returned no access_token')
  return assertion
}

/**
 * Discover FVKS token endpoint from MCP protected-resource / AS metadata, or use override.
 */
export async function resolveFvksTokenEndpoint(
  mcpUrl: string,
  explicitTokenUrl?: string | null
): Promise<string> {
  if (explicitTokenUrl?.trim()) return explicitTokenUrl.trim()

  const resourceMetadataUrls = [
    new URL('/.well-known/oauth-protected-resource', mcpUrl).toString(),
    (() => {
      try {
        const u = new URL(mcpUrl)
        return `${u.origin}/.well-known/oauth-protected-resource${u.pathname.replace(/\/$/, '')}`
      } catch {
        return null
      }
    })(),
  ].filter((u): u is string => Boolean(u))

  for (const url of resourceMetadataUrls) {
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      })
      if (!res.ok) continue
      const json = (await res.json()) as {
        authorization_servers?: unknown
        authorization_server?: unknown
      }
      const servers = Array.isArray(json.authorization_servers)
        ? json.authorization_servers
        : nonEmpty(json.authorization_server)
          ? [json.authorization_server]
          : []
      const asIssuer = nonEmpty(servers[0])
      if (!asIssuer) continue

      const discovery = await fetch(
        new URL('/.well-known/oauth-authorization-server', asIssuer).toString(),
        {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        }
      )
      if (!discovery.ok) continue
      const meta = (await discovery.json()) as { token_endpoint?: unknown }
      const tokenEndpoint = nonEmpty(meta.token_endpoint)
      if (tokenEndpoint) return tokenEndpoint
    } catch (error) {
      logger.debug('FVKS OAuth discovery hop failed', {
        url,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // FVKS / meet common layout when discovery is locked down: AS on same origin.
  try {
    const origin = new URL(mcpUrl).origin
    return `${origin}/oauth/token`
  } catch {
    throw new Error('FVKS_MCP_URL is not a valid URL')
  }
}

/**
 * RFC 7523 jwt-bearer at the FVKS token endpoint; captures grant_id/subject extras.
 */
export async function mintFvksTokensWithAssertion(params: {
  assertion: string
  mcpUrl: string
  connectorSlug?: string
  clientId?: string
  clientSecret?: string
  tokenUrl?: string | null
}): Promise<FvksStoredTokens> {
  const clientId = params.clientId ?? env.FVKS_MCP_CLIENT_ID
  const clientSecret = params.clientSecret ?? env.FVKS_MCP_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('FVKS_MCP_CLIENT_ID/SECRET are not configured')
  }

  const tokenEndpoint = await resolveFvksTokenEndpoint(
    params.mcpUrl,
    params.tokenUrl ?? env.FVKS_MCP_TOKEN_URL
  )

  const body = await postForm(tokenEndpoint, {
    grant_type: JWT_BEARER_GRANT,
    assertion: params.assertion,
    client_id: clientId,
    client_secret: clientSecret,
  })

  const accessToken = nonEmpty(body.access_token)
  if (!accessToken) throw new Error('FVKS jwt-bearer returned no access_token')

  const extras = extrasOfAccessToken(accessToken, body)
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : undefined

  return {
    access_token: accessToken,
    token_type: nonEmpty(body.token_type) ?? 'Bearer',
    refresh_token: nonEmpty(body.refresh_token),
    scope: nonEmpty(body.scope),
    expires_at: expiresIn != null ? Date.now() + expiresIn * 1000 : undefined,
    subject: extras.subject,
    grant_id: extras.grantId,
    acquired_via: 'token_exchange',
    connector_slug: params.connectorSlug ?? 'fvks',
    mcp_url: params.mcpUrl,
    updated_at: Date.now(),
  }
}

/**
 * Full Keycloak → FVKS mint for one audience/slug.
 */
export async function exchangeAndMintFvksTokens(params: {
  subjectToken: string
  audience: string
  connectorSlug: string
  mcpUrl: string
}): Promise<FvksStoredTokens> {
  const assertion = await exchangeSubjectToken({
    subjectToken: params.subjectToken,
    audience: params.audience,
  })
  return mintFvksTokensWithAssertion({
    assertion,
    mcpUrl: params.mcpUrl,
    connectorSlug: params.connectorSlug,
  })
}
