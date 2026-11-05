import { db } from '@sim/db'
import { environment } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { getRedisClient } from '@/lib/core/config/redis'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { FVKS_CONNECTION_ENV_KEY } from '@/lib/fvks/token-exchange'
import type { FvksConnectionPublic, FvksStoredTokens } from '@/lib/fvks/types'

const logger = createLogger('FvksConnectionStore')

const GRANT_KEY_PREFIX = 'fvks:grant:'
const GRANT_TTL_SECONDS = 60 * 60 * 24 * 30 // 30d; refreshed on each connect

function grantRedisKey(grantId: string): string {
  return `${GRANT_KEY_PREFIX}${grantId}`
}

function toPublic(stored: FvksStoredTokens | null): FvksConnectionPublic {
  if (!stored?.access_token) {
    return {
      connector: 'fvks',
      grant_id: null,
      subject: null,
      mcp_url: null,
      expires_at: null,
      acquired_via: null,
      connected: false,
    }
  }
  return {
    connector: stored.connector_slug,
    grant_id: stored.grant_id ?? null,
    subject: stored.subject ?? null,
    mcp_url: stored.mcp_url,
    expires_at: stored.expires_at ?? null,
    acquired_via: stored.acquired_via,
    connected: true,
  }
}

async function readPersonalEnvMap(userId: string): Promise<Record<string, string>> {
  const [row] = await db
    .select({ variables: environment.variables })
    .from(environment)
    .where(eq(environment.userId, userId))
    .limit(1)
  return (row?.variables as Record<string, string> | undefined) ?? {}
}

async function writePersonalEnvMap(
  userId: string,
  variables: Record<string, string>
): Promise<void> {
  const [existing] = await db
    .select({ id: environment.id })
    .from(environment)
    .where(eq(environment.userId, userId))
    .limit(1)

  if (existing) {
    await db
      .update(environment)
      .set({ variables, updatedAt: new Date() })
      .where(eq(environment.userId, userId))
    return
  }

  await db.insert(environment).values({
    id: userId || generateId(),
    userId,
    variables,
    updatedAt: new Date(),
  })
}

export async function loadFvksStoredTokens(userId: string): Promise<FvksStoredTokens | null> {
  const variables = await readPersonalEnvMap(userId)
  const encrypted = variables[FVKS_CONNECTION_ENV_KEY]
  if (!encrypted) return null
  try {
    const { decrypted } = await decryptSecret(encrypted)
    return JSON.parse(decrypted) as FvksStoredTokens
  } catch (error) {
    logger.warn('Failed to decrypt FVKS connection; clearing', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    })
    const next = { ...variables }
    delete next[FVKS_CONNECTION_ENV_KEY]
    await writePersonalEnvMap(userId, next)
    return null
  }
}

export async function saveFvksStoredTokens(
  userId: string,
  tokens: FvksStoredTokens
): Promise<FvksConnectionPublic> {
  const { encrypted } = await encryptSecret(JSON.stringify(tokens))
  const variables = await readPersonalEnvMap(userId)

  let previous: FvksStoredTokens | null = null
  const previousEncrypted = variables[FVKS_CONNECTION_ENV_KEY]
  if (previousEncrypted) {
    try {
      const { decrypted } = await decryptSecret(previousEncrypted)
      previous = JSON.parse(decrypted) as FvksStoredTokens
    } catch {
      previous = null
    }
  }

  await writePersonalEnvMap(userId, {
    ...variables,
    [FVKS_CONNECTION_ENV_KEY]: encrypted,
  })

  const redis = getRedisClient()
  if (redis) {
    try {
      if (previous?.grant_id && previous.grant_id !== tokens.grant_id) {
        await redis.del(grantRedisKey(previous.grant_id))
      }
      if (tokens.grant_id) {
        await redis.set(grantRedisKey(tokens.grant_id), userId, 'EX', GRANT_TTL_SECONDS)
      }
    } catch (error) {
      logger.warn('FVKS grant Redis index update failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return toPublic(tokens)
}

export async function clearFvksStoredTokens(userId: string): Promise<void> {
  const previous = await loadFvksStoredTokens(userId)
  const variables = await readPersonalEnvMap(userId)
  if (FVKS_CONNECTION_ENV_KEY in variables) {
    const next = { ...variables }
    delete next[FVKS_CONNECTION_ENV_KEY]
    await writePersonalEnvMap(userId, next)
  }
  if (previous?.grant_id) {
    const redis = getRedisClient()
    await redis?.del(grantRedisKey(previous.grant_id)).catch(() => undefined)
  }
}

export async function getFvksConnectionPublic(userId: string): Promise<FvksConnectionPublic> {
  return toPublic(await loadFvksStoredTokens(userId))
}

/**
 * Resolve Sim user id that owns a FVKS grant (webhook / ops lookup).
 * Primary: Redis index written on connect. Fallback: none (no table scan).
 */
export async function findUserIdByFvksGrantId(grantId: string): Promise<string | null> {
  const redis = getRedisClient()
  if (!redis) return null
  try {
    const userId = await redis.get(grantRedisKey(grantId))
    return userId || null
  } catch {
    return null
  }
}

export async function getAccessTokenForMcp(userId: string): Promise<{
  accessToken: string
  mcpUrl: string
  grantId?: string
} | null> {
  const stored = await loadFvksStoredTokens(userId)
  if (!stored?.access_token || !stored.mcp_url) return null
  if (stored.expires_at && stored.expires_at < Date.now() + 30_000) {
    logger.warn('FVKS access token near/past expiry; caller should re-connect', {
      userId,
      expiresAt: stored.expires_at,
    })
  }
  return {
    accessToken: stored.access_token,
    mcpUrl: stored.mcp_url,
    grantId: stored.grant_id,
  }
}
