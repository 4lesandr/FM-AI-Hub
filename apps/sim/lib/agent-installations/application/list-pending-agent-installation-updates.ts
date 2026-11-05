import { resolvePrincipalSubjectUserId, type SessionPrincipal } from '@sim/auth/principal'
import { agentInstallation, agentRelease, db, workflow } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { agentReleaseVisibleToInstaller } from '@/lib/agent-installations/share-access'
import { defineOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedCredentialUserUseCase } from '@/lib/credentials/application/authorized-user-use-case'

const logger = createLogger('ListPendingAgentInstallationUpdates')

export interface PendingAgentInstallationUpdate {
  installationId: string
  workflowId: string
  workflowName: string
  workspaceId: string | null
  pinnedReleaseId: string
  pinnedVersion: number
  latestReleaseId: string
  latestVersion: number
  updatePolicy: 'pending' | 'accepted' | 'deferred' | 'current'
  updatedAt: string
}

export interface ListPendingAgentInstallationUpdatesResult {
  updates: PendingAgentInstallationUpdate[]
}

/**
 * Session list of the caller's non-revoked installations waiting on Accept/Defer.
 * Publish N+1 sets updatePolicy=pending; this surfaces those rows with latest release meta.
 */
export const listPendingAgentInstallationUpdates = defineAuthorizedCredentialUserUseCase({
  // permission-group-exempt: lists only the caller's own agent_installation rows.
  operation: defineOperation({
    id: 'agent_installations.list_pending_updates',
    principalKinds: ['session'],
    capability: 'none',
  }),
  async execute({
    principal,
  }: {
    principal: SessionPrincipal
    input: Record<string, never>
  }): Promise<ListPendingAgentInstallationUpdatesResult> {
    const userId = resolvePrincipalSubjectUserId(principal)
    if (!userId) {
      throw new OrchestrationError('forbidden', 'Listing updates requires a signed-in user')
    }

    const pending = await db
      .select({
        installationId: agentInstallation.id,
        workspaceId: agentInstallation.workspaceId,
        updatePolicy: agentInstallation.updatePolicy,
        updatedAt: agentInstallation.updatedAt,
        pinnedReleaseId: agentRelease.id,
        pinnedVersion: agentRelease.version,
        pinnedOrganizationId: agentRelease.organizationId,
        workflowId: agentRelease.workflowId,
        workflowName: workflow.name,
      })
      .from(agentInstallation)
      .innerJoin(agentRelease, eq(agentRelease.id, agentInstallation.releaseId))
      .innerJoin(workflow, eq(workflow.id, agentRelease.workflowId))
      .where(
        and(
          eq(agentInstallation.userId, userId),
          eq(agentInstallation.updatePolicy, 'pending'),
          isNull(agentInstallation.revokedAt),
          agentReleaseVisibleToInstaller(userId)
        )
      )
      .orderBy(desc(agentInstallation.updatedAt))

    if (pending.length === 0) {
      return { updates: [] }
    }

    const latestByInstallation = new Map<string, { releaseId: string; version: number }>()

    for (const row of pending) {
      const tenantClause =
        row.pinnedOrganizationId === null
          ? isNull(agentRelease.organizationId)
          : eq(agentRelease.organizationId, row.pinnedOrganizationId)
      const [latest] = await db
        .select({
          releaseId: agentRelease.id,
          version: agentRelease.version,
        })
        .from(agentRelease)
        .where(and(eq(agentRelease.workflowId, row.workflowId), tenantClause))
        .orderBy(desc(agentRelease.version))
        .limit(1)

      if (latest) {
        latestByInstallation.set(row.installationId, latest)
      }
    }

    const updates: PendingAgentInstallationUpdate[] = []
    for (const row of pending) {
      const latest = latestByInstallation.get(row.installationId)
      if (!latest) continue

      updates.push({
        installationId: row.installationId,
        workflowId: row.workflowId,
        workflowName: row.workflowName,
        workspaceId: row.workspaceId,
        pinnedReleaseId: row.pinnedReleaseId,
        pinnedVersion: row.pinnedVersion,
        latestReleaseId: latest.releaseId,
        latestVersion: latest.version,
        updatePolicy: row.updatePolicy,
        updatedAt: row.updatedAt.toISOString(),
      })
    }

    logger.info('Listed pending agent installation updates', {
      userId,
      count: updates.length,
    })

    return { updates }
  },
})
