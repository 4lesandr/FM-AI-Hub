import { revokeAgentReleaseShareContract } from '@/lib/api/contracts/agent-releases'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { createInternalWorkflowErrorPolicy } from '@/lib/workflows/api'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { revokeAgentReleaseShare } from '@/lib/workflows/application/revoke-agent-release-share'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NO_INTERNAL_RATE_LIMIT = internalRateLimits.none({
  reason: 'Authenticated session revoke-share mirrors Publish admission.',
})

/**
 * POST /api/workflows/[id]/revoke-share
 * Invalidate active Install-by-link share tokens for this workflow.
 */
export const POST = defineInternalJsonRoute({
  contract: revokeAgentReleaseShareContract,
  operation: workflowOperations.publish,
  useCase: revokeAgentReleaseShare,
  auth: internalSessionAuth,
  rateLimit: NO_INTERNAL_RATE_LIMIT,
  errorPolicy: createInternalWorkflowErrorPolicy('Failed to revoke agent release share'),
  mapInput: ({ params }) => ({ workflowId: params.id }),
  present: (result) => ({
    workflowId: result.workflowId,
    sharesRevoked: result.sharesRevoked,
    revokedAt: result.revokedAt,
  }),
})
