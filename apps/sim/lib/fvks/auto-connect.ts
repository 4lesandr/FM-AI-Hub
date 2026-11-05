import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { env } from '@/lib/core/config/env'
import { getFvksConnectionPublic, saveFvksStoredTokens } from '@/lib/fvks/connection-store'
import {
  exchangeAndMintFvksTokens,
  parseIdpAudiences,
  resolveOidcIssuer,
  resolveOidcProviderId,
} from '@/lib/fvks/token-exchange'
import type { FvksConnectionPublic } from '@/lib/fvks/types'

const logger = createLogger('FvksAutoConnect')

export class FvksConnectError extends Error {
  constructor(
    message: string,
    readonly status: number = 400
  ) {
    super(message)
    this.name = 'FvksConnectError'
  }
}

export function isFvksAutoConnectConfigured(): boolean {
  const issuer = resolveOidcIssuer()
  const audiences = parseIdpAudiences()
  return Boolean(
    issuer &&
      audiences.has('fvks') &&
      (env.HUB_OIDC_CLIENT_ID || env.SSO_OIDC_CLIENT_ID) &&
      (env.HUB_OIDC_CLIENT_SECRET || env.SSO_OIDC_CLIENT_SECRET) &&
      env.FVKS_MCP_URL &&
      env.FVKS_MCP_CLIENT_ID &&
      env.FVKS_MCP_CLIENT_SECRET
  )
}

/**
 * Read the Keycloak (SSO) access token stored on the better-auth account row.
 */
export async function loadSsoAccessToken(userId: string): Promise<string | null> {
  const providerId = resolveOidcProviderId()
  const [row] = await db
    .select({
      accessToken: account.accessToken,
      providerId: account.providerId,
    })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, providerId)))
    .limit(1)

  if (row?.accessToken) return row.accessToken

  // SSO plugin may store providerId as configured id; also try literal 'keycloak'.
  if (providerId !== 'keycloak') {
    const [fallback] = await db
      .select({ accessToken: account.accessToken })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, 'keycloak')))
      .limit(1)
    if (fallback?.accessToken) return fallback.accessToken
  }

  return null
}

/**
 * Connect the user to FVKS MCP via token-exchange → jwt-bearer.
 * `subjectToken` overrides the SSO account token (meet Agents connect path).
 */
export async function connectFvksForUser(params: {
  userId: string
  subjectToken?: string | null
}): Promise<FvksConnectionPublic> {
  if (!isFvksAutoConnectConfigured()) {
    throw new FvksConnectError(
      'FVKS auto-connect is not configured (need HUB_OIDC_*, HUB_IDP_AUDIENCES=fvks=…, FVKS_MCP_*)',
      503
    )
  }

  const audiences = parseIdpAudiences()
  const audience = audiences.get('fvks')
  if (!audience) throw new FvksConnectError('HUB_IDP_AUDIENCES missing fvks=… audience', 503)

  const mcpUrl = env.FVKS_MCP_URL!.trim()
  const subjectToken = params.subjectToken?.trim() || (await loadSsoAccessToken(params.userId))
  if (!subjectToken) {
    throw new FvksConnectError(
      'No Keycloak subject token: sign in via SSO or pass subject_token',
      401
    )
  }

  try {
    const tokens = await exchangeAndMintFvksTokens({
      subjectToken,
      audience,
      connectorSlug: 'fvks',
      mcpUrl,
    })
    const publicView = await saveFvksStoredTokens(params.userId, tokens)
    logger.info('FVKS connected via token-exchange', {
      userId: params.userId,
      hasGrant: Boolean(publicView.grant_id),
      grantPrefix: publicView.grant_id?.slice(0, 12),
    })
    return publicView
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('FVKS connect failed', { userId: params.userId, error: message })
    throw new FvksConnectError(message, 502)
  }
}

export async function getFvksConnectionStatus(userId: string): Promise<FvksConnectionPublic> {
  return getFvksConnectionPublic(userId)
}
