import { type NextRequest, NextResponse } from 'next/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  agentsApiErrorResponse,
  authenticateAgentsApiRequest,
  cancelRun,
} from '@/lib/fvks/agents-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** POST /api/app/v1/runs/:id/cancel */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await context.params
      const { assertion, principal } = await authenticateAgentsApiRequest(request)
      const run = await cancelRun(principal, assertion, id)
      return NextResponse.json(run)
    } catch (error) {
      return agentsApiErrorResponse(error)
    }
  }
)
