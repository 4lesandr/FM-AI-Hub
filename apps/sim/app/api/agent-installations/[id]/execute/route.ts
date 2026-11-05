import { executeAgentInstallationContract } from '@/lib/api/contracts/agent-installations'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { executeAgentInstallation } from '@/lib/agent-installations/application/execute-agent-installation'
import { generateRequestId } from '@/lib/core/utils/request'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NO_INTERNAL_RATE_LIMIT = internalRateLimits.none({
  reason:
    'Authenticated session execute runs the caller own agent_installation under installer identity.',
})

/**
 * POST /api/agent-installations/[id]/execute
 * Runtime bind (#6): draft = AgentRelease state + Installation.credentialBindings;
 * actor/credentials = installer (installation.userId), not release owner.
 */
export const POST = defineInternalJsonRoute({
  contract: executeAgentInstallationContract,
  operation: executeAgentInstallation.operation,
  useCase: executeAgentInstallation,
  auth: internalSessionAuth,
  rateLimit: NO_INTERNAL_RATE_LIMIT,
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }, { request }) => ({
    installationId: params.id,
    input: body?.input,
    triggerBlockId: body?.triggerBlockId,
    requestId: generateRequestId(),
    abortSignal: request.signal,
    requestHeaders: request.headers,
  }),
  present: (result) => ({
    installationId: result.installationId,
    releaseId: result.releaseId,
    workflowId: result.workflowId,
    version: result.version,
    userId: result.userId,
    workspaceId: result.workspaceId,
    executionId: result.executionId,
    status: result.status,
    output: result.output,
    error: result.error,
  }),
})