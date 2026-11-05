import { deferAgentInstallationUpdateContract } from '@/lib/api/contracts/agent-installations'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { deferAgentInstallationUpdate } from '@/lib/agent-installations/application/defer-agent-installation-update'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NO_INTERNAL_RATE_LIMIT = internalRateLimits.none({
  reason: 'Authenticated session Defer marks the caller own agent_installation updatePolicy.',
})

/**
 * POST /api/agent-installations/[id]/defer
 * Defer pending update — stay pinned; updatePolicy=deferred.
 */
export const POST = defineInternalJsonRoute({
  contract: deferAgentInstallationUpdateContract,
  operation: deferAgentInstallationUpdate.operation,
  useCase: deferAgentInstallationUpdate,
  auth: internalSessionAuth,
  rateLimit: NO_INTERNAL_RATE_LIMIT,
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({
    installationId: params.id,
  }),
  present: (result) => result,
})
