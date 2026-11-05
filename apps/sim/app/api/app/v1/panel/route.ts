import { type NextRequest, NextResponse } from 'next/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  agentsApiErrorResponse,
  authenticateAgentsApiRequest,
  buildPanel,
} from '@/lib/fvks/agents-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/app/v1/panel — Agents panel for FVKS meet (FMAH Agents API parity).
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const { assertion, principal } = await authenticateAgentsApiRequest(request)
    const query = Object.fromEntries(request.nextUrl.searchParams.entries())
    const panel = await buildPanel(principal, assertion, query)
    return NextResponse.json(panel)
  } catch (error) {
    return agentsApiErrorResponse(error)
  }
})
