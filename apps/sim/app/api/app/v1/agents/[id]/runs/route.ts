import { type NextRequest, NextResponse } from 'next/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  agentsApiErrorResponse,
  authenticateAgentsApiRequest,
  sendMessage,
} from '@/lib/fvks/agents-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/app/v1/agents/:id/runs — start / continue a chat-style agent run.
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await context.params
      const { assertion, principal } = await authenticateAgentsApiRequest(request)
      const body = await request.json().catch(() => ({}))
      const run = await sendMessage(principal, assertion, id, body)
      return NextResponse.json(run, { status: 201 })
    } catch (error) {
      return agentsApiErrorResponse(error)
    }
  }
)
