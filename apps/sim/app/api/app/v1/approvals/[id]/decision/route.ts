import { type NextRequest, NextResponse } from 'next/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  agentsApiErrorResponse,
  authenticateAgentsApiRequest,
  decideApproval,
} from '@/lib/fvks/agents-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** POST /api/app/v1/approvals/:id/decision — HITL not yet mapped; 404 until parity. */
export const POST = withRouteHandler(
  async (request: NextRequest, _context: { params: Promise<{ id: string }> }) => {
    try {
      await authenticateAgentsApiRequest(request)
      await request.json().catch(() => ({}))
      await decideApproval()
      return new NextResponse(null, { status: 204 })
    } catch (error) {
      return agentsApiErrorResponse(error)
    }
  }
)
