import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { catchUpFvksEventsForUser } from '@/lib/fvks/catch-up'

const logger = createLogger('FvksEventsCatchUpAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * POST /api/fvks/events/catch-up
 *
 * Session-scoped catch-up: MCP `list_events` → same grant_id fan-out as the webhook.
 * For localdev smoke after downtime; prod prefers the cron route.
 */
export const POST = withRouteHandler(async (_request: NextRequest) => {
  const requestId = generateRequestId()
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await catchUpFvksEventsForUser(session.user.id, requestId)
    return NextResponse.json({ ok: !result.error, result, requestId })
  } catch (error) {
    logger.error(`[${requestId}] FVKS catch-up failed`, { error: getErrorMessage(error) })
    return NextResponse.json({ error: 'Internal error', requestId }, { status: 500 })
  }
})
