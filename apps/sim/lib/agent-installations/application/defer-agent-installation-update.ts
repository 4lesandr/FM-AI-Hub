import { resolvePrincipalSubjectUserId, type SessionPrincipal } from '@sim/auth/principal'
import { agentInstallation, agentRelease, db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { defineOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedCredentialUserUseCase } from '@/lib/credentials/application/authorized-user-use-case'

const logger = createLogger('DeferAgentInstallationUpdate')

export interface DeferAgentInstallationUpdateInput {
  installationId: string
}

export interface DeferAgentInstallationUpdateResult {
  installationId: string
  workflowId: string
  releaseId: string
  version: number
  updatePolicy: 'deferred'
  workspaceId: string | null
  updatedAt: string
}

/**
 * Defer a pending update: keep the pinned release, set updatePolicy=deferred.
 * Publish N+1 will mark the row pending again.
 */
export const deferAgentInstallationUpdate = defineAuthorizedCredentialUserUseCase({
  // permission-group-exempt: mutates only the caller's own agent_installation row.
  operation: defineOperation({
    id: 'agent_installations.defer_update',
    principalKinds: ['session'],
    capability: 'none',
  }),
  async execute({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: DeferAgentInstallationUpdateInput
  }): Promise<DeferAgentInstallationUpdateResult> {
    const userId = resolvePrincipalSubjectUserId(principal)
    if (!userId) {
      throw new OrchestrationError('forbidden', 'Defer requires a signed-in user')
    }

    const installationId = input.installationId.trim()
    if (!installationId) {
      throw new OrchestrationError('validation', 'Installation id is required')
    }

    const [installation] = await db
      .select({
        id: agentInstallation.id,
        releaseId: agentInstallation.releaseId,
        workspaceId: agentInstallation.workspaceId,
        updatePolicy: agentInstallation.updatePolicy,
      })
      .from(agentInstallation)
      .where(
        and(
          eq(agentInstallation.id, installationId),
          eq(agentInstallation.userId, userId),
          isNull(agentInstallation.revokedAt)
        )
      )
      .limit(1)

    if (!installation) {
      throw new OrchestrationError('not_found', 'Agent installation not found')
    }

    if (installation.updatePolicy !== 'pending' && installation.updatePolicy !== 'deferred') {
      throw new OrchestrationError(
        'validation',
        `Installation has no pending update (updatePolicy=${installation.updatePolicy})`
      )
    }

    const [pinned] = await db
      .select({
        workflowId: agentRelease.workflowId,
        version: agentRelease.version,
      })
      .from(agentRelease)
      .where(eq(agentRelease.id, installation.releaseId))
      .limit(1)

    if (!pinned) {
      throw new OrchestrationError('not_found', 'Pinned agent release not found')
    }

    const now = new Date()
    const [updated] = await db
      .update(agentInstallation)
      .set({ updatePolicy: 'deferred', updatedAt: now })
      .where(eq(agentInstallation.id, installation.id))
      .returning({
        id: agentInstallation.id,
        releaseId: agentInstallation.releaseId,
        workspaceId: agentInstallation.workspaceId,
        updatedAt: agentInstallation.updatedAt,
      })

    logger.info('Deferred agent installation update', {
      installationId: updated.id,
      workflowId: pinned.workflowId,
      releaseId: updated.releaseId,
      version: pinned.version,
      userId,
    })

    return {
      installationId: updated.id,
      workflowId: pinned.workflowId,
      releaseId: updated.releaseId,
      version: pinned.version,
      updatePolicy: 'deferred',
      workspaceId: updated.workspaceId,
      updatedAt: updated.updatedAt.toISOString(),
    }
  },
})
