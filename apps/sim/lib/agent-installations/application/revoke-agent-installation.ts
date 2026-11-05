import { resolvePrincipalSubjectUserId, type SessionPrincipal } from '@sim/auth/principal'
import { agentInstallation, agentRelease, db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { defineOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedCredentialUserUseCase } from '@/lib/credentials/application/authorized-user-use-case'

const logger = createLogger('RevokeAgentInstallation')

export interface RevokeAgentInstallationInput {
  installationId: string
}

export interface RevokeAgentInstallationResult {
  installationId: string
  releaseId: string
  workflowId: string
  version: number
  revokedAt: string
  /** AgentRelease is never deleted or mutated by revoke. */
  releaseIntact: true
}

/**
 * Soft-revoke the caller's Installation (sets revokedAt). AgentRelease and other
 * users' installations stay alive — App Store edition is independent of one revoke.
 */
export const revokeAgentInstallation = defineAuthorizedCredentialUserUseCase({
  // permission-group-exempt: mutates only the caller's own agent_installation row.
  operation: defineOperation({
    id: 'agent_installations.revoke',
    principalKinds: ['session'],
    capability: 'none',
  }),
  async execute({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: RevokeAgentInstallationInput
  }): Promise<RevokeAgentInstallationResult> {
    const userId = resolvePrincipalSubjectUserId(principal)
    if (!userId) {
      throw new OrchestrationError('forbidden', 'Revoke requires a signed-in user')
    }

    const installationId = input.installationId.trim()
    if (!installationId) {
      throw new OrchestrationError('validation', 'Installation id is required')
    }

    const [installation] = await db
      .select({
        id: agentInstallation.id,
        releaseId: agentInstallation.releaseId,
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

    const [pinned] = await db
      .select({
        id: agentRelease.id,
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
      .set({ revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(agentInstallation.id, installation.id),
          eq(agentInstallation.userId, userId),
          isNull(agentInstallation.revokedAt)
        )
      )
      .returning({
        id: agentInstallation.id,
        releaseId: agentInstallation.releaseId,
        revokedAt: agentInstallation.revokedAt,
      })

    if (!updated?.revokedAt) {
      throw new OrchestrationError('not_found', 'Agent installation not found')
    }

    // Confirm AgentRelease row still exists and was not mutated by this revoke.
    const [releaseAfter] = await db
      .select({ id: agentRelease.id })
      .from(agentRelease)
      .where(eq(agentRelease.id, pinned.id))
      .limit(1)

    if (!releaseAfter) {
      throw new OrchestrationError('internal', 'Agent release missing after installation revoke')
    }

    logger.info('Revoked agent installation', {
      installationId: updated.id,
      releaseId: updated.releaseId,
      workflowId: pinned.workflowId,
      version: pinned.version,
      userId,
    })

    return {
      installationId: updated.id,
      releaseId: updated.releaseId,
      workflowId: pinned.workflowId,
      version: pinned.version,
      revokedAt: updated.revokedAt.toISOString(),
      releaseIntact: true,
    }
  },
})
