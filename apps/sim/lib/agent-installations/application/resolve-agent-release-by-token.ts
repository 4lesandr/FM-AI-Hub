import type { SessionPrincipal } from '@sim/auth/principal'
import { agentInstallation, agentRelease, db, workflow } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, desc, eq, isNull } from 'drizzle-orm'
import {
  collectAgentCredentialSlots,
  type AgentCredentialSlot,
} from '@/lib/agent-installations/credential-slots'
import {
  agentReleaseVisibleToInstaller,
  assertInstallerMayResolveShare,
} from '@/lib/agent-installations/share-access'
import { defineOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedCredentialUserUseCase } from '@/lib/credentials/application/authorized-user-use-case'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('ResolveAgentReleaseByToken')

export interface ResolveAgentReleaseByTokenInput {
  shareToken: string
}

export interface ResolveAgentReleaseByTokenResult {
  releaseId: string
  workflowId: string
  organizationId: string | null
  workflowName: string
  workflowDescription: string | null
  version: number
  shareToken: string
  createdAt: string
  credentialSlots: AgentCredentialSlot[]
  installation: {
    id: string
    updatePolicy: 'pending' | 'accepted' | 'deferred' | 'current'
    workspaceId: string | null
    pinnedReleaseId: string
    pinnedVersion: number
    createdAt: string
    updatedAt: string
  } | null
}

/**
 * Session resolve of a Publish share token → safe Install meta (no release state / secrets).
 */
export const resolveAgentReleaseByToken = defineAuthorizedCredentialUserUseCase({
  // permission-group-exempt: share-token resolve only reveals redacted Install meta the link holder needs.
  operation: defineOperation({
    id: 'agent_releases.resolve_by_token',
    principalKinds: ['session'],
    capability: 'none',
  }),
  async execute({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: ResolveAgentReleaseByTokenInput
  }): Promise<ResolveAgentReleaseByTokenResult> {
    const token = input.shareToken.trim()
    if (!token) {
      throw new OrchestrationError('validation', 'Share token is required')
    }

    const [row] = await db
      .select({
        releaseId: agentRelease.id,
        workflowId: agentRelease.workflowId,
        organizationId: agentRelease.organizationId,
        version: agentRelease.version,
        shareToken: agentRelease.shareToken,
        state: agentRelease.state,
        createdAt: agentRelease.createdAt,
        workflowName: workflow.name,
        workflowDescription: workflow.description,
      })
      .from(agentRelease)
      .innerJoin(workflow, eq(workflow.id, agentRelease.workflowId))
      .where(
        and(
          eq(agentRelease.shareToken, token),
          isNull(agentRelease.shareRevokedAt),
          agentReleaseVisibleToInstaller(principal.userId)
        )
      )
      .limit(1)

    if (!row) {
      throw new OrchestrationError('not_found', 'Agent release not found for this share token')
    }

    await assertInstallerMayResolveShare({
      installerUserId: principal.userId,
      workflowId: row.workflowId,
      releaseOrganizationId: row.organizationId,
    })

    // Any active Installation for this user+workflow (pin may lag the share-token release after Publish N+1).
    const [existing] = await db
      .select({
        id: agentInstallation.id,
        updatePolicy: agentInstallation.updatePolicy,
        workspaceId: agentInstallation.workspaceId,
        createdAt: agentInstallation.createdAt,
        updatedAt: agentInstallation.updatedAt,
        pinnedReleaseId: agentRelease.id,
        pinnedVersion: agentRelease.version,
      })
      .from(agentInstallation)
      .innerJoin(agentRelease, eq(agentRelease.id, agentInstallation.releaseId))
      .where(
        and(
          eq(agentInstallation.userId, principal.userId),
          eq(agentRelease.workflowId, row.workflowId),
          isNull(agentInstallation.revokedAt)
        )
      )
      .orderBy(desc(agentInstallation.updatedAt))
      .limit(1)

    const credentialSlots = collectAgentCredentialSlots(row.state as Partial<WorkflowState>)

    logger.info('Resolved agent release by share token', {
      releaseId: row.releaseId,
      workflowId: row.workflowId,
      organizationId: row.organizationId,
      version: row.version,
      credentialSlotCount: credentialSlots.length,
      alreadyInstalled: Boolean(existing),
      updatePolicy: existing?.updatePolicy ?? null,
    })

    return {
      releaseId: row.releaseId,
      workflowId: row.workflowId,
      organizationId: row.organizationId,
      workflowName: row.workflowName,
      workflowDescription: row.workflowDescription,
      version: row.version,
      shareToken: row.shareToken,
      createdAt: row.createdAt.toISOString(),
      credentialSlots,
      installation: existing
        ? {
            id: existing.id,
            updatePolicy: existing.updatePolicy,
            workspaceId: existing.workspaceId,
            pinnedReleaseId: existing.pinnedReleaseId,
            pinnedVersion: existing.pinnedVersion,
            createdAt: existing.createdAt.toISOString(),
            updatedAt: existing.updatedAt.toISOString(),
          }
        : null,
    }
  },
})
