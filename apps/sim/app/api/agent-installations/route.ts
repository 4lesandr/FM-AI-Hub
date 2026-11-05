import { installAgentReleaseContract } from '@/lib/api/contracts/agent-installations'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { installAgentRelease } from '@/lib/agent-installations/application/install-agent-release'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NO_INTERNAL_RATE_LIMIT = internalRateLimits.none({
  reason: 'Authenticated session Install creates the caller own agent_installation row.',
})

/**
 * POST /api/agent-installations
 * Session Install by share token → agent_installation + installer credential bindings.
 * Identity on later runs = installer (installation.userId).
 */
export const POST = defineInternalJsonRoute({
  contract: installAgentReleaseContract,
  operation: installAgentRelease.operation,
  useCase: installAgentRelease,
  auth: internalSessionAuth,
  rateLimit: NO_INTERNAL_RATE_LIMIT,
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => ({
    shareToken: body.shareToken,
    workspaceId: body.workspaceId,
    credentialBindings: body.credentialBindings ?? {},
  }),
  present: (result) => result,
})
