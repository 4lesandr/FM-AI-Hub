import { type NextRequest, NextResponse } from 'next/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  agentsApiErrorResponse,
  authenticateAgentsApiRequest,
  getRun,
} from '@/lib/fvks/agents-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET /api/app/v1/runs/:id */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await context.params
      const { assertion, principal } = await authenticateAgentsApiRequest(request)
      const run = await getRun(principal, assertion, id)
      return NextResponse.json(run)
    } catch (error) {
      return agentsApiErrorResponse(error)
    }
  }
)
