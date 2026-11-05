import { publishAgentReleaseContract } from '@/lib/api/contracts/agent-releases'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { createInternalWorkflowErrorPolicy } from '@/lib/workflows/api'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { publishAgentRelease } from '@/lib/workflows/application/publish-agent-release'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NO_INTERNAL_RATE_LIMIT = internalRateLimits.none({
  reason: 'Authenticated session Publish retains the same admission policy as deploy UI ops.',
})

/**
 * POST /api/workflows/[id]/publish
 * Session Publish → AgentRelease (sanitized snapshot) + share token URL.
 */
export const POST = defineInternalJsonRoute({
  contract: publishAgentReleaseContract,
  operation: workflowOperations.publish,
  useCase: publishAgentRelease,
  auth: internalSessionAuth,
  rateLimit: NO_INTERNAL_RATE_LIMIT,
  errorPolicy: createInternalWorkflowErrorPolicy('Failed to publish agent release'),
  mapInput: ({ params, body }) => ({
    workflowId: params.id,
    promptTier: body?.promptTier,
  }),
  present: (result) => ({
    releaseId: result.releaseId,
    workflowId: result.workflowId,
    organizationId: result.organizationId,
    version: result.version,
    shareToken: result.shareToken,
    shareUrl: result.shareUrl,
    createdAt: result.createdAt,
    installationsMarkedPending: result.installationsMarkedPending,
    sharesRevoked: result.sharesRevoked,
    promptTier: result.promptTier,
  }),
})
