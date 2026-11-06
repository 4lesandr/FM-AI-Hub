import { resolvePrincipalSubjectUserId, type SessionPrincipal } from '@sim/auth/principal'
import { agentInstallation, agentRelease, db, workflow } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { agentReleaseVisibleToInstaller } from '@/lib/agent-installations/share-access'
import { defineOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedCredentialUserUseCase } from '@/lib/credentials/application/authorized-user-use-case'

const logger = createLogger('ListAgentInstallations')

export interface AgentInstallationListItem {
  id: string
  /** Display name for sidebar («мои приложения») — pinned release workflow name. */
  name: string
  workflowId: string
  workspaceId: string | null
  pinnedReleaseId: string
  pinnedVersion: number
  updatePolicy: 'pending' | 'accepted' | 'deferred' | 'current'
  /** True when updatePolicy=pending (Accept/Defer available). */
  pendingUpdate: boolean
  createdAt: string
  updatedAt: string
}

export interface ListAgentInstallationsResult {
  installations: AgentInstallationListItem[]
}

/**
 * Session list of the caller's active (non-revoked) Installations for agent-home sidebar.
 * Revoked rows are hidden. Cross-tenant releases are filtered via share-access visibility.
 */
export const listAgentInstallations = defineAuthorizedCredentialUserUseCase({
  // permission-group-exempt: lists only the caller's own agent_installation rows.
  operation: defineOperation({
    id: 'agent_installations.list',
    principalKinds: ['session'],
    capability: 'none',
  }),
  async execute({
    principal,
  }: {
    principal: SessionPrincipal
    input: Record<string, never>
  }): Promise<ListAgentInstallationsResult> {
    const userId = resolvePrincipalSubjectUserId(principal)
    if (!userId) {
      throw new OrchestrationError('forbidden', 'Listing installations requires a signed-in user')
    }

    const rows = await db
      .select({
        id: agentInstallation.id,
        workspaceId: agentInstallation.workspaceId,
        updatePolicy: agentInstallation.updatePolicy,
        createdAt: agentInstallation.createdAt,
        updatedAt: agentInstallation.updatedAt,
        pinnedReleaseId: agentRelease.id,
        pinnedVersion: agentRelease.version,
        workflowId: agentRelease.workflowId,
        name: workflow.name,
      })
      .from(agentInstallation)
      .innerJoin(agentRelease, eq(agentRelease.id, agentInstallation.releaseId))
      .innerJoin(workflow, eq(workflow.id, agentRelease.workflowId))
      .where(
        and(
          eq(agentInstallation.userId, userId),
          isNull(agentInstallation.revokedAt),
          agentReleaseVisibleToInstaller(userId)
        )
      )
      .orderBy(desc(agentInstallation.updatedAt))

    const installations: AgentInstallationListItem[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      workflowId: row.workflowId,
      workspaceId: row.workspaceId,
      pinnedReleaseId: row.pinnedReleaseId,
      pinnedVersion: row.pinnedVersion,
      updatePolicy: row.updatePolicy,
      pendingUpdate: row.updatePolicy === 'pending',
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }))

    logger.info('Listed agent installations', {
      userId,
      count: installations.length,
    })

    return { installations }
  },
})
