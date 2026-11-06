import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getInstallationChat } from '@/lib/agent-installations/application/get-installation-chat'
import { createInstallationChatTurnStream } from '@/lib/agent-installations/chat/stream-chat-turn'
import {
  getInstallationChatContract,
  postInstallationChatContract,
} from '@/lib/api/contracts/agent-installations'
import { parseRequest } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  InternalUnauthenticatedError,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  asOrchestrationError,
  messageForOrchestrationError,
  statusForOrchestrationError,
} from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const logger = createLogger('InstallationChatAPI')

const NO_INTERNAL_RATE_LIMIT = internalRateLimits.none({
  reason:
    'Authenticated session chat runs under the caller own agent_installation installer identity.',
})

/**
 * GET /api/agent-installations/[id]/chat
 * Hydrate InstallationThread history for the pane (reload-safe).
 */
export const GET = defineInternalJsonRoute({
  contract: getInstallationChatContract,
  operation: getInstallationChat.operation,
  useCase: getInstallationChat,
  auth: internalSessionAuth,
  rateLimit: NO_INTERNAL_RATE_LIMIT,
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({
    installationId: params.id,
  }),
  present: (result) => ({
    installationId: result.installationId,
    threadId: result.threadId,
    messages: result.messages,
  }),
})

/**
 * POST /api/agent-installations/[id]/chat
 * Stream one turn (SSE agent-events-v1) and persist user/assistant messages.
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    try {
      const principal = await internalSessionAuth.authenticate()
      const parsed = await parseRequest(postInstallationChatContract, request, context)
      if (!parsed.success) return parsed.response

      return await createInstallationChatTurnStream({
        principal,
        installationId: parsed.data.params.id,
        message: parsed.data.body.message,
        requestId,
        abortSignal: request.signal,
        requestHeaders: request.headers,
      })
    } catch (error) {
      if (error instanceof InternalUnauthenticatedError) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const orchestrationError = asOrchestrationError(error)
      if (orchestrationError) {
        logger.warn('Installation chat POST refused', {
          requestId,
          code: orchestrationError.code,
          message: orchestrationError.message,
        })
        return NextResponse.json(
          { error: messageForOrchestrationError(orchestrationError) },
          { status: statusForOrchestrationError(orchestrationError) }
        )
      }
      logger.error('Installation chat POST failed', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
