import { revokeAgentInstallationContract } from '@/lib/api/contracts/agent-installations'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { revokeAgentInstallation } from '@/lib/agent-installations/application/revoke-agent-installation'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NO_INTERNAL_RATE_LIMIT = internalRateLimits.none({
  reason: 'Authenticated session soft-revokes the caller own agent_installation only.',
})

/**
 * DELETE /api/agent-installations/[id]
 * Soft-revoke Installation (revokedAt). AgentRelease for other installers stays alive.
 */
export const DELETE = defineInternalJsonRoute({
  contract: revokeAgentInstallationContract,
  operation: revokeAgentInstallation.operation,
  useCase: revokeAgentInstallation,
  auth: internalSessionAuth,
  rateLimit: NO_INTERNAL_RATE_LIMIT,
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({
    installationId: params.id,
  }),
  present: (result) => result,
})
