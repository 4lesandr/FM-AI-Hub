import { resolvePrincipalSubjectUserId, type SessionPrincipal } from '@sim/auth/principal'
import { agentInstallation, agentRelease, db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, desc, eq, isNull, ne } from 'drizzle-orm'
import {
  assertRequiredCredentialSlotsBound,
  collectAgentCredentialSlots,
} from '@/lib/agent-installations/credential-slots'
import { AuthType } from '@/lib/auth/hybrid'
import { authorizeCredentialUseForAuth } from '@/lib/auth/credential-access'
import { defineOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedCredentialUserUseCase } from '@/lib/credentials/application/authorized-user-use-case'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('AcceptAgentInstallationUpdate')

export interface AcceptAgentInstallationUpdateInput {
  installationId: string
}

export interface AcceptAgentInstallationUpdateResult {
  installationId: string
  workflowId: string
  previousReleaseId: string
  previousVersion: number
  releaseId: string
  version: number
  updatePolicy: 'pending' | 'accepted' | 'deferred' | 'current'
  workspaceId: string | null
  credentialBindings: Record<string, string>
  updatedAt: string
  consolidated: boolean
}

function normalizeBindings(
  raw: Record<string, string> | null | undefined
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, credentialId] of Object.entries(raw ?? {})) {
    if (credentialId?.trim()) out[key] = credentialId.trim()
  }
  return out
}

/**
 * Keep only bindings that still exist as slots on the target release.
 * Required slots must still be bound (H3); unknown/stale keys are dropped.
 */
function filterBindingsToSlots(
  bindings: Record<string, string>,
  slots: ReturnType<typeof collectAgentCredentialSlots>
): Record<string, string> {
  const allowed = new Set(slots.map((slot) => slot.key))
  const filtered: Record<string, string> = {}
  for (const [key, credentialId] of Object.entries(bindings)) {
    if (allowed.has(key)) filtered[key] = credentialId
  }
  assertRequiredCredentialSlotsBound(slots, filtered)
  return filtered
}

/**
 * Accept pending/deferred update: repin Installation to the latest AgentRelease
 * for the same workflow. Re-asserts required credential slots against the latest
 * release state (H3) and re-authorizes remaining bindings as the installer.
 */
export const acceptAgentInstallationUpdate = defineAuthorizedCredentialUserUseCase({
  // permission-group-exempt: mutates only the caller's own agent_installation row.
  operation: defineOperation({
    id: 'agent_installations.accept_update',
    principalKinds: ['session'],
    capability: 'none',
  }),
  async execute({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: AcceptAgentInstallationUpdateInput
  }): Promise<AcceptAgentInstallationUpdateResult> {
    const userId = resolvePrincipalSubjectUserId(principal)
    if (!userId) {
      throw new OrchestrationError('forbidden', 'Accept requires a signed-in user')
    }

    const installationId = input.installationId.trim()
    if (!installationId) {
      throw new OrchestrationError('validation', 'Installation id is required')
    }

    const [preflight] = await db
      .select({
        id: agentInstallation.id,
        releaseId: agentInstallation.releaseId,
        workspaceId: agentInstallation.workspaceId,
        credentialBindings: agentInstallation.credentialBindings,
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

    if (!preflight) {
      throw new OrchestrationError('not_found', 'Agent installation not found')
    }

    if (preflight.updatePolicy !== 'pending' && preflight.updatePolicy !== 'deferred') {
      throw new OrchestrationError(
        'validation',
        `Installation has no pending update (updatePolicy=${preflight.updatePolicy})`
      )
    }

    const [pinned] = await db
      .select({
        id: agentRelease.id,
        workflowId: agentRelease.workflowId,
        version: agentRelease.version,
      })
      .from(agentRelease)
      .where(eq(agentRelease.id, preflight.releaseId))
      .limit(1)

    if (!pinned) {
      throw new OrchestrationError('not_found', 'Pinned agent release not found')
    }

    const [latest] = await db
      .select({
        id: agentRelease.id,
        version: agentRelease.version,
        state: agentRelease.state,
      })
      .from(agentRelease)
      .where(eq(agentRelease.workflowId, pinned.workflowId))
      .orderBy(desc(agentRelease.version))
      .limit(1)

    if (!latest) {
      throw new OrchestrationError('not_found', 'No agent release found for this workflow')
    }

    const slots = collectAgentCredentialSlots(latest.state as Partial<WorkflowState>)
    const existingBindings = normalizeBindings(
      preflight.credentialBindings as Record<string, string> | null
    )
    const credentialBindings = filterBindingsToSlots(existingBindings, slots)

    if (!preflight.workspaceId && Object.keys(credentialBindings).length > 0) {
      throw new OrchestrationError(
        'validation',
        'Installation workspace is required to re-assert credential bindings on Accept'
      )
    }

    for (const [slotKey, credentialId] of Object.entries(credentialBindings)) {
      const access = await authorizeCredentialUseForAuth(
        { success: true, userId, authType: AuthType.SESSION },
        { credentialId, workspaceId: preflight.workspaceId! }
      )
      if (!access.ok) {
        throw new OrchestrationError(
          'forbidden',
          access.error ?? `Cannot use credential for slot ${slotKey}`
        )
      }
    }

    const result = await db.transaction(async (tx) => {
      const [installation] = await tx
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

      const now = new Date()
      const previousReleaseId = pinned.id
      const previousVersion = pinned.version

      if (latest.id === installation.releaseId) {
        const [updated] = await tx
          .update(agentInstallation)
          .set({
            updatePolicy: 'current',
            credentialBindings,
            updatedAt: now,
          })
          .where(eq(agentInstallation.id, installation.id))
          .returning({
            id: agentInstallation.id,
            releaseId: agentInstallation.releaseId,
            workspaceId: agentInstallation.workspaceId,
            credentialBindings: agentInstallation.credentialBindings,
            updatePolicy: agentInstallation.updatePolicy,
            updatedAt: agentInstallation.updatedAt,
          })

        return {
          installationId: updated.id,
          workflowId: pinned.workflowId,
          previousReleaseId,
          previousVersion,
          releaseId: updated.releaseId,
          version: latest.version,
          updatePolicy: updated.updatePolicy,
          workspaceId: updated.workspaceId,
          credentialBindings: (updated.credentialBindings ?? {}) as Record<string, string>,
          updatedAt: updated.updatedAt.toISOString(),
          consolidated: false,
        }
      }

      const [existingOnLatest] = await tx
        .select({
          id: agentInstallation.id,
          workspaceId: agentInstallation.workspaceId,
          credentialBindings: agentInstallation.credentialBindings,
        })
        .from(agentInstallation)
        .where(
          and(
            eq(agentInstallation.userId, userId),
            eq(agentInstallation.releaseId, latest.id),
            isNull(agentInstallation.revokedAt),
            ne(agentInstallation.id, installation.id)
          )
        )
        .limit(1)

      if (existingOnLatest) {
        await tx
          .update(agentInstallation)
          .set({ revokedAt: now, updatedAt: now })
          .where(eq(agentInstallation.id, installation.id))

        const [updated] = await tx
          .update(agentInstallation)
          .set({
            updatePolicy: 'current',
            credentialBindings,
            updatedAt: now,
          })
          .where(eq(agentInstallation.id, existingOnLatest.id))
          .returning({
            id: agentInstallation.id,
            releaseId: agentInstallation.releaseId,
            workspaceId: agentInstallation.workspaceId,
            credentialBindings: agentInstallation.credentialBindings,
            updatePolicy: agentInstallation.updatePolicy,
            updatedAt: agentInstallation.updatedAt,
          })

        return {
          installationId: updated.id,
          workflowId: pinned.workflowId,
          previousReleaseId,
          previousVersion,
          releaseId: updated.releaseId,
          version: latest.version,
          updatePolicy: updated.updatePolicy,
          workspaceId: updated.workspaceId,
          credentialBindings: (updated.credentialBindings ?? {}) as Record<string, string>,
          updatedAt: updated.updatedAt.toISOString(),
          consolidated: true,
        }
      }

      const [updated] = await tx
        .update(agentInstallation)
        .set({
          releaseId: latest.id,
          updatePolicy: 'current',
          credentialBindings,
          updatedAt: now,
        })
        .where(eq(agentInstallation.id, installation.id))
        .returning({
          id: agentInstallation.id,
          releaseId: agentInstallation.releaseId,
          workspaceId: agentInstallation.workspaceId,
          credentialBindings: agentInstallation.credentialBindings,
          updatePolicy: agentInstallation.updatePolicy,
          updatedAt: agentInstallation.updatedAt,
        })

      return {
        installationId: updated.id,
        workflowId: pinned.workflowId,
        previousReleaseId,
        previousVersion,
        releaseId: updated.releaseId,
        version: latest.version,
        updatePolicy: updated.updatePolicy,
        workspaceId: updated.workspaceId,
        credentialBindings: (updated.credentialBindings ?? {}) as Record<string, string>,
        updatedAt: updated.updatedAt.toISOString(),
        consolidated: false,
      }
    })

    logger.info('Accepted agent installation update', {
      installationId: result.installationId,
      workflowId: result.workflowId,
      previousReleaseId: result.previousReleaseId,
      releaseId: result.releaseId,
      version: result.version,
      consolidated: result.consolidated,
      bindingCount: Object.keys(result.credentialBindings).length,
      userId,
    })

    return result
  },
})
