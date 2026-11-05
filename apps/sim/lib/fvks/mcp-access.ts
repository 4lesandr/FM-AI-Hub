import { createLogger } from '@sim/logger'
import { getAccessTokenForMcp } from '@/lib/fvks/connection-store'

const logger = createLogger('FvksMcpAccess')

/**
 * Authorization header for outbound FVKS MCP calls under the user's stored grant.
 * Agents never see the raw token — callers use this only inside hub/runtime code.
 */
export async function getFvksMcpAuthHeaders(userId: string): Promise<{
  mcpUrl: string
  headers: Record<string, string>
  grantId?: string
} | null> {
  const access = await getAccessTokenForMcp(userId)
  if (!access) return null
  return {
    mcpUrl: access.mcpUrl,
    grantId: access.grantId,
    headers: {
      authorization: `Bearer ${access.accessToken}`,
      accept: 'application/json, text/event-stream',
    },
  }
}

/**
 * Minimal smoke: HTTP GET/POST probe against FVKS_MCP_URL with the stored Bearer.
 * Does not speak full MCP initialize — only proves credential acceptance at the edge.
 */
export async function probeFvksMcpWithStoredGrant(userId: string): Promise<{
  ok: boolean
  status?: number
  mcpUrl?: string
  grantId?: string
  error?: string
}> {
  const auth = await getFvksMcpAuthHeaders(userId)
  if (!auth) {
    return { ok: false, error: 'no stored FVKS connection' }
  }

  try {
    const response = await fetch(auth.mcpUrl, {
      method: 'POST',
      headers: {
        ...auth.headers,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'fm-ai-hub', version: '0.0.0' },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    })

    const ok = response.status < 500
    if (!ok) {
      logger.warn('FVKS MCP probe non-success', {
        status: response.status,
        grantPrefix: auth.grantId?.slice(0, 12),
      })
    }
    return {
      ok: response.ok || response.status === 401 || response.status === 403 ? response.ok : ok,
      status: response.status,
      mcpUrl: auth.mcpUrl,
      grantId: auth.grantId,
    }
  } catch (error) {
    return {
      ok: false,
      mcpUrl: auth.mcpUrl,
      grantId: auth.grantId,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
