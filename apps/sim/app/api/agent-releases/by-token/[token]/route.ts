import { resolveAgentReleaseByTokenContract } from '@/lib/api/contracts/agent-installations'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { resolveAgentReleaseByToken } from '@/lib/agent-installations/application/resolve-agent-release-by-token'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NO_INTERNAL_RATE_LIMIT = internalRateLimits.none({
  reason: 'Authenticated session resolve of a share token is Install meta only.',
})

/**
 * GET /api/agent-releases/by-token/[token]
 * Session resolve → Install meta without release secrets.
 */
export const GET = defineInternalJsonRoute({
  contract: resolveAgentReleaseByTokenContract,
  operation: resolveAgentReleaseByToken.operation,
  useCase: resolveAgentReleaseByToken,
  auth: internalSessionAuth,
  rateLimit: NO_INTERNAL_RATE_LIMIT,
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ shareToken: params.token }),
  present: (result) => result,
})
