import { acceptAgentInstallationUpdateContract } from '@/lib/api/contracts/agent-installations'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { acceptAgentInstallationUpdate } from '@/lib/agent-installations/application/accept-agent-installation-update'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NO_INTERNAL_RATE_LIMIT = internalRateLimits.none({
  reason: 'Authenticated session Accept repins the caller own agent_installation.',
})

/**
 * POST /api/agent-installations/[id]/accept
 * Accept pending/deferred update → repin to latest AgentRelease for the workflow.
 */
export const POST = defineInternalJsonRoute({
  contract: acceptAgentInstallationUpdateContract,
  operation: acceptAgentInstallationUpdate.operation,
  useCase: acceptAgentInstallationUpdate,
  auth: internalSessionAuth,
  rateLimit: NO_INTERNAL_RATE_LIMIT,
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({
    installationId: params.id,
  }),
  present: (result) => result,
})
