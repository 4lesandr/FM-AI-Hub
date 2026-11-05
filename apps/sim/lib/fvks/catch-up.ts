import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { NextRequest } from 'next/server'
import {
  advanceFvksEventsCursor,
  clearFvksStoredTokens,
  getAccessTokenForMcp,
  listFvksConnectedUserIds,
  loadFvksStoredTokens,
} from '@/lib/fvks/connection-store'
import { McpClient } from '@/lib/mcp/client'
import { dispatchResolvedWebhookTarget, findWebhooksByRoutingKey } from '@/lib/webhooks/processor'

const logger = createLogger('FvksEventsCatchUp')

const MAX_PAGES = 50
const PAGE_LIMIT = 100

export interface FvksListEventsPage {
  events: Array<Record<string, unknown>>
  nextCursor: string | null
}

/**
 * Parse MCP `list_events` tool result (structuredContent, top-level, or JSON text).
 */
export function parseFvksListEventsResult(raw: unknown): FvksListEventsPage {
  const root = unwrapMcpToolPayload(raw)
  if (!root) return { events: [], nextCursor: null }

  const eventsRaw = root.events
  const events = Array.isArray(eventsRaw)
    ? eventsRaw.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    : []

  const next =
    root.next_cursor !== undefined && root.next_cursor !== null ? String(root.next_cursor) : null

  return { events, nextCursor: next }
}

function unwrapMcpToolPayload(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as {
    events?: unknown
    next_cursor?: unknown
    structuredContent?: unknown
    content?: Array<{ type?: string; text?: string }>
  }
  if (Array.isArray(r.events) || r.next_cursor !== undefined) {
    return r as Record<string, unknown>
  }
  if (r.structuredContent && typeof r.structuredContent === 'object') {
    return r.structuredContent as Record<string, unknown>
  }
  const text = (r.content ?? [])
    .filter((c) => c?.type === 'text' || typeof c?.text === 'string')
    .map((c) => c.text ?? '')
    .join('')
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function eventCursor(event: Record<string, unknown>): string | null {
  const c = event.cursor
  if (c == null) return null
  return String(c)
}

function eventOccurredMs(event: Record<string, unknown>): number | null {
  const raw = event.occurred_at
  if (typeof raw !== 'string') return null
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : null
}

function toWebhookBody(
  event: Record<string, unknown>,
  grantId: string,
  subject: unknown
): Record<string, unknown> {
  return {
    event,
    grant_id: grantId,
    subject: subject ?? undefined,
  }
}

export interface FvksCatchUpUserResult {
  userId: string
  grantId?: string
  pages: number
  events: number
  dispatched: number
  failed: number
  cursor?: string | null
  skipped?: string
  error?: string
}

/**
 * Catch up one user's FVKS journal via MCP `list_events`, fan-out like the webhook ingress.
 */
export async function catchUpFvksEventsForUser(
  userId: string,
  requestId: string
): Promise<FvksCatchUpUserResult> {
  const stored = await loadFvksStoredTokens(userId)
  if (!stored?.grant_id || !stored.access_token || !stored.mcp_url) {
    return { userId, pages: 0, events: 0, dispatched: 0, failed: 0, skipped: 'no_connection' }
  }

  const access = await getAccessTokenForMcp(userId)
  if (!access) {
    return { userId, pages: 0, events: 0, dispatched: 0, failed: 0, skipped: 'no_access_token' }
  }

  const grantId = stored.grant_id
  const sinceMs = stored.events_since_ms ?? stored.updated_at
  let cursor = stored.events_cursor ?? null
  let pages = 0
  let eventsSeen = 0
  let dispatched = 0
  let failed = 0

  const client = new McpClient({
    config: {
      id: `fvks-catch-up-${userId}`,
      name: 'FVKS catch-up',
      transport: 'streamable-http',
      url: access.mcpUrl,
      authType: 'headers',
      headers: {
        Authorization: `Bearer ${access.accessToken}`,
      },
      timeout: 30_000,
    },
    securityPolicy: {
      requireConsent: false,
      auditLevel: 'basic',
    },
  })

  try {
    await client.connect()

    for (let page = 0; page < MAX_PAGES; page++) {
      const args: Record<string, unknown> = { limit: PAGE_LIMIT }
      if (cursor) {
        args.since_cursor = /^\d+$/.test(cursor) ? Number(cursor) : cursor
      }

      const raw = await client.callTool({ name: 'list_events', arguments: args })
      if (raw.isError) {
        const errText =
          raw.content
            ?.map((c) => c.text)
            .filter(Boolean)
            .join(' ') || 'list_events error'
        throw new Error(errText)
      }

      const { events, nextCursor } = parseFvksListEventsResult(raw)
      pages += 1
      const before = cursor

      for (const event of events) {
        const type = typeof event.type === 'string' ? event.type : ''
        if (type === 'grant.revoked') {
          logger.info(`[${requestId}] FVKS catch-up saw grant.revoked; clearing connection`, {
            grantPrefix: grantId.slice(0, 12),
          })
          await clearFvksStoredTokens(userId)
          return {
            userId,
            grantId,
            pages,
            events: eventsSeen + 1,
            dispatched,
            failed,
            cursor,
            skipped: 'grant_revoked',
          }
        }

        const occurred = eventOccurredMs(event)
        if (occurred != null && occurred < sinceMs) {
          const ec = eventCursor(event)
          if (ec) cursor = ec
          continue
        }

        eventsSeen += 1
        const body = toWebhookBody(event, grantId, stored.subject)
        const synthetic = new NextRequest('http://localhost/api/webhooks/fvks/catch-up', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-fvks-grant-id': grantId },
        })
        const webhooks = await findWebhooksByRoutingKey(grantId, requestId, 'fvks')
        for (const { webhook, workflow, triggerBlockDeployed } of webhooks) {
          const result = await dispatchResolvedWebhookTarget(webhook, workflow, body, synthetic, {
            requestId,
            receivedAt: Date.now(),
            triggerBlockDeployed,
          })
          if (result.outcome === 'queued') dispatched += 1
          if (result.outcome === 'failed') failed += 1
        }

        const ec = eventCursor(event)
        if (ec) cursor = ec
      }

      if (nextCursor != null) cursor = nextCursor
      if (!events.length || cursor === before) break
    }

    if (cursor) {
      await advanceFvksEventsCursor(userId, cursor)
    }

    return { userId, grantId, pages, events: eventsSeen, dispatched, failed, cursor }
  } catch (error) {
    logger.warn(`[${requestId}] FVKS catch-up failed for user`, {
      error: getErrorMessage(error),
      grantPrefix: grantId.slice(0, 12),
    })
    return {
      userId,
      grantId,
      pages,
      events: eventsSeen,
      dispatched,
      failed,
      cursor,
      error: getErrorMessage(error),
    }
  } finally {
    await client.disconnect().catch(() => undefined)
  }
}

/**
 * Cron: catch-up all indexed FVKS connections.
 */
export async function catchUpFvksEventsAll(requestId: string): Promise<{
  users: number
  results: FvksCatchUpUserResult[]
}> {
  const userIds = await listFvksConnectedUserIds()
  const results: FvksCatchUpUserResult[] = []
  for (const userId of userIds) {
    results.push(await catchUpFvksEventsForUser(userId, requestId))
  }
  return { users: userIds.length, results }
}
