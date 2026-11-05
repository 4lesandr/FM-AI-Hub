import { type NextRequest, NextResponse } from 'next/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  agentsApiErrorResponse,
  authenticateAgentsApiRequest,
  getThread,
} from '@/lib/fvks/agents-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET /api/app/v1/threads/:id */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await context.params
      const { assertion, principal } = await authenticateAgentsApiRequest(request)
      const thread = await getThread(principal, assertion, id)
      return NextResponse.json(thread)
    } catch (error) {
      return agentsApiErrorResponse(error)
    }
  }
)
