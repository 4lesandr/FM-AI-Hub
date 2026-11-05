import { resolvePrincipalSubjectUserId, type SessionPrincipal } from '@sim/auth/principal'
import { agentInstallation, agentRelease, db, workflow } from '@sim/db'
import { createLogger } from '@sim/logger'
import { mergeSubblockStateWithValues } from '@sim/workflow-persistence/subblocks'
import { and, eq, isNull } from 'drizzle-orm'
import {
  agentReleaseStateToDraft,
  applyAgentInstallationCredentialBindings,
} from '@/lib/agent-installations/apply-credential-bindings'
import { authorizeCredentialUseForAuth } from '@/lib/auth/credential-access'
import { AuthType } from '@/lib/auth/hybrid'
import { defineOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { defineAuthorizedCredentialUserUseCase } from '@/lib/credentials/application/authorized-user-use-case'
import { withholdUnadmittedInlineFiles } from '@/lib/workflows/application/admit-run-files'
import {
  type ExecuteWorkflowServiceRun,
  executeWorkflowService,
} from '@/lib/workflows/executor/execute-service'
import {
  resolveTriggerRunOptions,
  validateTriggerInput,
} from '@/lib/workflows/triggers/run-options'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('ExecuteAgentInstallation')

export interface ExecuteAgentInstallationInput {
  installationId: string
  input?: unknown
  triggerBlockId?: string
  requestId?: string
  abortSignal?: AbortSignal
  requestHeaders?: Headers
}

export interface ExecuteAgentInstallationResult {
  installationId: string
  releaseId: string
  workflowId: string
  version: number
  /** Installer identity — never AgentRelease.createdBy / workflow.userId. */
  userId: string
  workspaceId: string
  executionId: string
  status: ExecuteWorkflowServiceRun['status']
  output: ExecuteWorkflowServiceRun['output']
  error: ExecuteWorkflowServiceRun['error']
}

function listTriggers(options: ReturnType<typeof resolveTriggerRunOptions>): string {
  return options.map((option) => `${option.triggerBlockId} (${option.blockName})`).join(', ')
}

/**
 * Session run of an Installation: draft = pinned AgentRelease state + installer
 * credentialBindings; actor/billing/credential access = installation.userId +
 * installation.workspaceId. Does not use the release author's credentials or
 * workspace identity. FVKS webhook/deploy paths are untouched.
 */
export const executeAgentInstallation = defineAuthorizedCredentialUserUseCase({
  // permission-group-exempt: runs only the caller's own agent_installation.
  operation: defineOperation({
    id: 'agent_installations.execute',
    principalKinds: ['session'],
    capability: 'none',
  }),
  async execute({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: ExecuteAgentInstallationInput
  }): Promise<ExecuteAgentInstallationResult> {
    const installerUserId = resolvePrincipalSubjectUserId(principal)
    if (!installerUserId) {
      throw new OrchestrationError('forbidden', 'Execute requires a signed-in user')
    }

    const installationId = input.installationId.trim()
    if (!installationId) {
      throw new OrchestrationError('validation', 'Installation id is required')
    }

    const [row] = await db
      .select({
        installationId: agentInstallation.id,
        installerUserId: agentInstallation.userId,
        workspaceId: agentInstallation.workspaceId,
        credentialBindings: agentInstallation.credentialBindings,
        releaseId: agentRelease.id,
        releaseState: agentRelease.state,
        releaseVersion: agentRelease.version,
        workflowId: agentRelease.workflowId,
      })
      .from(agentInstallation)
      .innerJoin(agentRelease, eq(agentRelease.id, agentInstallation.releaseId))
      .where(
        and(
          eq(agentInstallation.id, installationId),
          eq(agentInstallation.userId, installerUserId),
          isNull(agentInstallation.revokedAt)
        )
      )
      .limit(1)

    if (!row) {
      throw new OrchestrationError('not_found', 'Agent installation not found')
    }

    if (!row.workspaceId) {
      throw new OrchestrationError(
        'validation',
        'Installation has no workspace; reinstall with a workspace to bind credentials'
      )
    }

    const credentialBindings = (row.credentialBindings ?? {}) as Record<string, string>
    for (const [slotKey, credentialId] of Object.entries(credentialBindings)) {
      const access = await authorizeCredentialUseForAuth(
        { success: true, userId: installerUserId, authType: AuthType.SESSION },
        { credentialId, workspaceId: row.workspaceId }
      )
      if (!access.ok) {
        throw new OrchestrationError(
          'forbidden',
          access.error ?? `Cannot use credential for slot ${slotKey}`
        )
      }
    }

    const [authorWorkflow] = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, row.workflowId))
      .limit(1)

    if (!authorWorkflow || authorWorkflow.archivedAt) {
      throw new OrchestrationError('not_found', 'Published workflow for this installation not found')
    }

    /**
     * Prefetch for preprocess/execute: keep the published workflow id for logs,
     * but force installer userId + workspaceId so runtime identity/credentials
     * never fall back to AgentRelease owner.
     */
    const installerWorkflowRecord = {
      ...authorWorkflow,
      userId: installerUserId,
      workspaceId: row.workspaceId,
    }

    const boundState = applyAgentInstallationCredentialBindings(
      row.releaseState as Partial<WorkflowState>,
      credentialBindings
    )
    const draftState = agentReleaseStateToDraft(boundState)
    const triggerOptions = resolveTriggerRunOptions(mergeSubblockStateWithValues(draftState.blocks))
    if (triggerOptions.length === 0) {
      throw new OrchestrationError(
        'validation',
        'No runnable trigger found in the pinned agent release'
      )
    }

    let selected = triggerOptions[0]
    if (input.triggerBlockId) {
      const explicit = triggerOptions.find((option) => option.triggerBlockId === input.triggerBlockId)
      if (!explicit) {
        throw new OrchestrationError(
          'validation',
          `triggerBlockId "${input.triggerBlockId}" is not a runnable trigger. Valid: ${listTriggers(triggerOptions)}.`
        )
      }
      selected = explicit
    } else if (triggerOptions.length > 1) {
      throw new OrchestrationError(
        'validation',
        `Multiple runnable triggers; pass triggerBlockId: ${listTriggers(triggerOptions)}.`
      )
    }

    const validation = validateTriggerInput(selected, input.input)
    if (!validation.ok) {
      throw new OrchestrationError('validation', validation.error ?? 'Invalid trigger input')
    }

    const requestId = input.requestId ?? generateRequestId()
    const result = await executeWorkflowService({
      workflowId: row.workflowId,
      principal,
      userId: installerUserId,
      input: input.input,
      triggerType: 'manual',
      requestId,
      useAuthenticatedUserAsActor: true,
      workflowRecord: installerWorkflowRecord,
      rateLimitCounter: 'sync',
      abortSignal: input.abortSignal,
      mode: 'sync',
      requestHeaders: input.requestHeaders ?? new Headers(),
      triggerBlockId: selected.triggerBlockId,
      useDraftState: true,
      draftState,
    })

    if (!result.ok) {
      const status = result.failure.statusCode
      throw new OrchestrationError(
        status === 404
          ? 'not_found'
          : status === 403
            ? 'forbidden'
            : status === 409
              ? 'conflict'
              : status >= 500
                ? 'internal'
                : 'validation',
        result.failure.message
      )
    }

    if ('queued' in result || 'stream' in result || 'pending' in result) {
      throw new OrchestrationError('validation', 'Installation execute supports sync mode only')
    }

    const admitted = await withholdUnadmittedInlineFiles(principal, row.workspaceId, result)

    logger.info('Executed agent installation under installer identity', {
      installationId: row.installationId,
      releaseId: row.releaseId,
      workflowId: row.workflowId,
      version: row.releaseVersion,
      workspaceId: row.workspaceId,
      installerUserId,
      authorUserId: authorWorkflow.userId,
      executionId: admitted.executionId,
      status: admitted.status,
      bindingCount: Object.keys(credentialBindings).length,
    })

    return {
      installationId: row.installationId,
      releaseId: row.releaseId,
      workflowId: row.workflowId,
      version: row.releaseVersion,
      userId: installerUserId,
      workspaceId: row.workspaceId,
      executionId: admitted.executionId,
      status: admitted.status,
      output: admitted.output,
      error: admitted.error,
    }
  },
})
