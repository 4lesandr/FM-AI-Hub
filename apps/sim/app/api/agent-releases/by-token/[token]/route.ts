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

/** Per-user bucket: share-token resolve is cheap but enumerable if unbounded. */
const RESOLVE_BY_TOKEN_RATE_LIMIT = internalRateLimits.user({
  bucketName: 'agent-releases.by-token',
  config: {
    maxTokens: 30,
    refillRate: 15,
    refillIntervalMs: 60_000,
  },
})

/**
 * GET /api/agent-releases/by-token/[token]
 * Session resolve → Install meta without release secrets (org-bound + rate-limited).
 */
export const GET = defineInternalJsonRoute({
  contract: resolveAgentReleaseByTokenContract,
  operation: resolveAgentReleaseByToken.operation,
  useCase: resolveAgentReleaseByToken,
  auth: internalSessionAuth,
  rateLimit: RESOLVE_BY_TOKEN_RATE_LIMIT,
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ shareToken: params.token }),
  present: (result) => result,
})
