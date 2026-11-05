import { type NextRequest, NextResponse } from 'next/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  agentsApiErrorResponse,
  authenticateAgentsApiRequest,
  connectFromApp,
} from '@/lib/fvks/agents-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/app/v1/connect — Keycloak subject_token → FVKS grant (meet autoconnect).
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const { principal } = await authenticateAgentsApiRequest(request)
    const body = await request.json().catch(() => ({}))
    const result = await connectFromApp(principal, body)
    return NextResponse.json(result)
  } catch (error) {
    return agentsApiErrorResponse(error)
  }
})
