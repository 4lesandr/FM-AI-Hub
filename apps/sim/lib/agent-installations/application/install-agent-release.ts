import { resolvePrincipalSubjectUserId, type SessionPrincipal } from '@sim/auth/principal'
import { agentInstallation, agentRelease, db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import {
  collectAgentCredentialSlots,
  type AgentCredentialSlot,
} from '@/lib/agent-installations/credential-slots'
import { AuthType } from '@/lib/auth/hybrid'
import { authorizeCredentialUseForAuth } from '@/lib/auth/credential-access'
import { defineOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedCredentialUserUseCase } from '@/lib/credentials/application/authorized-user-use-case'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('InstallAgentRelease')

export interface InstallAgentReleaseInput {
  shareToken: string
  workspaceId: string
  credentialBindings: Record<string, string>
}

export interface InstallAgentReleaseResult {
  installationId: string
  releaseId: string
  workflowId: string
  version: number
  userId: string
  workspaceId: string
  updatePolicy: 'pending' | 'accepted' | 'deferred' | 'current'
  credentialBindings: Record<string, string>
  createdAt: string
  updatedAt: string
  alreadyInstalled: boolean
}

function assertRequiredSlotsBound(
  slots: AgentCredentialSlot[],
  bindings: Record<string, string>
): void {
  const missing = slots.filter((slot) => slot.required && !bindings[slot.key]?.trim())
  if (missing.length > 0) {
    throw new OrchestrationError(
      'validation',
      `Missing required credential bindings: ${missing.map((slot) => slot.key).join(', ')}`
    )
  }

  const allowed = new Set(slots.map((slot) => slot.key))
  for (const key of Object.keys(bindings)) {
    if (!allowed.has(key)) {
      throw new OrchestrationError('validation', `Unknown credential slot: ${key}`)
    }
  }
}

/**
 * Session Install by share token → agent_installation owned by the installer.
 * Credential bindings are authorized as the installer in their workspace (not the author).
 */
export const installAgentRelease = defineAuthorizedCredentialUserUseCase({
  // permission-group-exempt: Install creates the caller's own instance; runtime identity is the installer.
  operation: defineOperation({
    id: 'agent_installations.install',
    principalKinds: ['session'],
    capability: 'none',
  }),
  async execute({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: InstallAgentReleaseInput
  }): Promise<InstallAgentReleaseResult> {
    const installerUserId = resolvePrincipalSubjectUserId(principal)
    if (!installerUserId) {
      throw new OrchestrationError('forbidden', 'Install requires a signed-in user')
    }

    const token = input.shareToken.trim()
    if (!token) {
      throw new OrchestrationError('validation', 'Share token is required')
    }

    const workspacePermission = await getUserEntityPermissions(
      installerUserId,
      'workspace',
      input.workspaceId
    )
    if (!workspacePermission) {
      throw new OrchestrationError('forbidden', 'You do not have access to this workspace')
    }

    const [release] = await db
      .select({
        id: agentRelease.id,
        workflowId: agentRelease.workflowId,
        version: agentRelease.version,
        state: agentRelease.state,
      })
      .from(agentRelease)
      .where(eq(agentRelease.shareToken, token))
      .limit(1)

    if (!release) {
      throw new OrchestrationError('not_found', 'Agent release not found for this share token')
    }

    const slots = collectAgentCredentialSlots(release.state as Partial<WorkflowState>)
    const credentialBindings: Record<string, string> = {}
    for (const [key, credentialId] of Object.entries(input.credentialBindings ?? {})) {
      if (credentialId?.trim()) credentialBindings[key] = credentialId.trim()
    }
    assertRequiredSlotsBound(slots, credentialBindings)

    for (const [slotKey, credentialId] of Object.entries(credentialBindings)) {
      const access = await authorizeCredentialUseForAuth(
        { success: true, userId: installerUserId, authType: AuthType.SESSION },
        { credentialId, workspaceId: input.workspaceId }
      )
      if (!access.ok) {
        throw new OrchestrationError(
          'forbidden',
          access.error ?? `Cannot use credential for slot ${slotKey}`
        )
      }
    }

    const now = new Date()
    const [existing] = await db
      .select({
        id: agentInstallation.id,
        updatePolicy: agentInstallation.updatePolicy,
        createdAt: agentInstallation.createdAt,
      })
      .from(agentInstallation)
      .where(
        and(
          eq(agentInstallation.userId, installerUserId),
          eq(agentInstallation.releaseId, release.id),
          isNull(agentInstallation.revokedAt)
        )
      )
      .limit(1)

    if (existing) {
      const [updated] = await db
        .update(agentInstallation)
        .set({
          workspaceId: input.workspaceId,
          credentialBindings,
          updatedAt: now,
        })
        .where(eq(agentInstallation.id, existing.id))
        .returning({
          id: agentInstallation.id,
          updatePolicy: agentInstallation.updatePolicy,
          createdAt: agentInstallation.createdAt,
          updatedAt: agentInstallation.updatedAt,
        })

      logger.info('Updated existing agent installation credential bindings', {
        installationId: existing.id,
        releaseId: release.id,
        workflowId: release.workflowId,
        bindingCount: Object.keys(credentialBindings).length,
      })

      return {
        installationId: updated.id,
        releaseId: release.id,
        workflowId: release.workflowId,
        version: release.version,
        userId: installerUserId,
        workspaceId: input.workspaceId,
        updatePolicy: updated.updatePolicy,
        credentialBindings,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        alreadyInstalled: true,
      }
    }

    const installationId = generateId()
    await db.insert(agentInstallation).values({
      id: installationId,
      userId: installerUserId,
      releaseId: release.id,
      workspaceId: input.workspaceId,
      credentialBindings,
      updatePolicy: 'current',
      createdAt: now,
      updatedAt: now,
    })

    logger.info('Installed agent release for installer', {
      installationId,
      releaseId: release.id,
      workflowId: release.workflowId,
      version: release.version,
      workspaceId: input.workspaceId,
      bindingCount: Object.keys(credentialBindings).length,
      installerUserId,
    })

    return {
      installationId,
      releaseId: release.id,
      workflowId: release.workflowId,
      version: release.version,
      userId: installerUserId,
      workspaceId: input.workspaceId,
      updatePolicy: 'current',
      credentialBindings,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      alreadyInstalled: false,
    }
  },
})
