import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { catchUpFvksEventsAll } from '@/lib/fvks/catch-up'

const logger = createLogger('FvksEventsCatchUpCron')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * GET /api/cron/fvks-events-catch-up
 *
 * Parity with FMAH `HUB_EVENTS_CATCH_UP_CRON` (~10 min): resume `list_events` for
 * indexed FVKS connections after push retries are exhausted (~40 min).
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const authError = verifyCronAuth(request, 'FVKS events catch-up')
  if (authError) return authError

  const requestId = generateRequestId()
  try {
    const summary = await catchUpFvksEventsAll(requestId)
    const errors = summary.results.filter((r) => r.error).length
    logger.info(`[${requestId}] FVKS catch-up cron finished`, {
      users: summary.users,
      errors,
    })
    return NextResponse.json({ ok: true, requestId, ...summary })
  } catch (error) {
    logger.error(`[${requestId}] FVKS catch-up cron failed`, { error: getErrorMessage(error) })
    return NextResponse.json({ error: 'Internal error', requestId }, { status: 500 })
  }
})
