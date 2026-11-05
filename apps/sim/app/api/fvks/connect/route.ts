import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { connectFvksForUser, FvksConnectError } from '@/lib/fvks/auto-connect'

const logger = createLogger('FvksConnectAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/fvks/connect
 *
 * Keycloak → token-exchange → FVKS jwt-bearer; persists tokens + grant_id.
 * Body (optional): `{ "subject_token": "<keycloak access>" }` for meet/Agents path
 * (parity with FMAH POST /api/app/v1/connect). Without body token, uses SSO account token.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // boundary-raw-json: optional subject_token envelope; empty body is valid (SSO account token)
    const raw = await request.json().catch(() => ({}))
    const subjectToken =
      raw &&
      typeof raw === 'object' &&
      typeof (raw as { subject_token?: unknown }).subject_token === 'string'
        ? (raw as { subject_token: string }).subject_token
        : undefined

    const connection = await connectFvksForUser({
      userId: session.user.id,
      subjectToken,
    })

    return NextResponse.json({
      ok: true,
      connection,
      requestId,
    })
  } catch (error) {
    if (error instanceof FvksConnectError) {
      logger.warn(`[${requestId}] FVKS connect rejected`, {
        error: error.message,
        status: error.status,
      })
      return NextResponse.json({ error: error.message, requestId }, { status: error.status })
    }
    logger.error(`[${requestId}] FVKS connect failed`, { error: getErrorMessage(error) })
    return NextResponse.json({ error: 'Internal error', requestId }, { status: 500 })
  }
})
