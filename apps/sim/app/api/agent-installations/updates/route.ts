import { listPendingAgentInstallationUpdatesContract } from '@/lib/api/contracts/agent-installations'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { listPendingAgentInstallationUpdates } from '@/lib/agent-installations/application/list-pending-agent-installation-updates'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NO_INTERNAL_RATE_LIMIT = internalRateLimits.none({
  reason: 'Authenticated session list of the caller own pending agent_installation updates.',
})

/**
 * GET /api/agent-installations/updates
 * Session list of installations with updatePolicy=pending (Accept/Defer channel).
 */
export const GET = defineInternalJsonRoute({
  contract: listPendingAgentInstallationUpdatesContract,
  operation: listPendingAgentInstallationUpdates.operation,
  useCase: listPendingAgentInstallationUpdates,
  auth: internalSessionAuth,
  rateLimit: NO_INTERNAL_RATE_LIMIT,
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: () => ({}),
  present: (result) => result,
})
