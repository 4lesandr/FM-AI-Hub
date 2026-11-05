import { type NextRequest, NextResponse } from 'next/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  accessLink,
  agentsApiErrorResponse,
  authenticateAgentsApiRequest,
} from '@/lib/fvks/agents-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/app/v1/agents/:id/access — consent URL (null when FVKS already connected).
 */
export const POST = withRouteHandler(
  async (request: NextRequest, _context: { params: Promise<{ id: string }> }) => {
    try {
      await authenticateAgentsApiRequest(request)
      const link = await accessLink()
      return NextResponse.json(link)
    } catch (error) {
      return agentsApiErrorResponse(error)
    }
  }
)
