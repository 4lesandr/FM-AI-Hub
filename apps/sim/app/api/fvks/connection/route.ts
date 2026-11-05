import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getFvksConnectionStatus, isFvksAutoConnectConfigured } from '@/lib/fvks/auto-connect'

const logger = createLogger('FvksConnectionAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/fvks/connection — public view of stored FVKS grant (no tokens).
 */
export const GET = withRouteHandler(async () => {
  const requestId = generateRequestId()
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const connection = await getFvksConnectionStatus(session.user.id)
    return NextResponse.json({
      ok: true,
      configured: isFvksAutoConnectConfigured(),
      connection,
      requestId,
    })
  } catch (error) {
    logger.error(`[${requestId}] FVKS connection status failed`, { error: getErrorMessage(error) })
    return NextResponse.json({ error: 'Internal error', requestId }, { status: 500 })
  }
})
