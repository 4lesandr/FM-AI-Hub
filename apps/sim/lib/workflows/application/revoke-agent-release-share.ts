import { resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { agentRelease, db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { resolvePrincipalWorkflowContext } from '@/lib/workflows/application/principal-scope'

const logger = createLogger('RevokeAgentReleaseShare')

export interface RevokeAgentReleaseShareInput {
  workflowId: string
  assertedWorkspaceId?: string
}

export interface RevokeAgentReleaseShareResult {
  workflowId: string
  workspaceId: string
  sharesRevoked: number
  revokedAt: string
}

/**
 * Invalidate all active Install-by-link share tokens for a workflow (H4).
 * Existing Installations keep running; only resolve/install by token fail.
 * Author re-Publishes to mint a fresh share URL.
 */
export const revokeAgentReleaseShare = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.publish,
  resolveContext: resolvePrincipalWorkflowContext<RevokeAgentReleaseShareInput>,
  async execute({ principal, context }): Promise<RevokeAgentReleaseShareResult> {
    const actorId = resolvePrincipalSubjectUserId(principal)
    if (!actorId) {
      throw new OrchestrationError('forbidden', 'Revoke share requires a signed-in user')
    }

    const revokedAt = new Date()
    const revoked = await db
      .update(agentRelease)
      .set({ shareRevokedAt: revokedAt })
      .where(
        and(eq(agentRelease.workflowId, context.workflowId), isNull(agentRelease.shareRevokedAt))
      )
      .returning({ id: agentRelease.id })

    if (revoked.length === 0) {
      throw new OrchestrationError('not_found', 'No active share link for this workflow')
    }

    logger.info('Revoked agent release share tokens', {
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      sharesRevoked: revoked.length,
      actorId,
    })

    return {
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      sharesRevoked: revoked.length,
      revokedAt: revokedAt.toISOString(),
    }
  },
})
