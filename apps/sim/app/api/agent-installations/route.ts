import {
  installAgentReleaseContract,
  listAgentInstallationsContract,
} from '@/lib/api/contracts/agent-installations'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { installAgentRelease } from '@/lib/agent-installations/application/install-agent-release'
import { listAgentInstallations } from '@/lib/agent-installations/application/list-agent-installations'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NO_INTERNAL_RATE_LIMIT_LIST = internalRateLimits.none({
  reason: 'Authenticated session list of the caller own agent_installation rows.',
})

const NO_INTERNAL_RATE_LIMIT_INSTALL = internalRateLimits.none({
  reason: 'Authenticated session Install creates the caller own agent_installation row.',
})

/**
 * GET /api/agent-installations
 * Session list of active Installations (revoked hidden) for agent-home sidebar.
 */
export const GET = defineInternalJsonRoute({
  contract: listAgentInstallationsContract,
  operation: listAgentInstallations.operation,
  useCase: listAgentInstallations,
  auth: internalSessionAuth,
  rateLimit: NO_INTERNAL_RATE_LIMIT_LIST,
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: () => ({}),
  present: (result) => result,
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
  rateLimit: NO_INTERNAL_RATE_LIMIT_INSTALL,
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => ({
    shareToken: body.shareToken,
    workspaceId: body.workspaceId,
    credentialBindings: body.credentialBindings ?? {},
  }),
  present: (result) => result,
})
