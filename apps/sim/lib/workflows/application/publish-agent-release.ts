import { resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { agentInstallation, agentRelease, db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { generateId, generateShortId } from '@sim/utils/id'
import { and, eq, inArray, isNull, max, ne } from 'drizzle-orm'
import {
  hardenAgentReleaseSnapshot,
  resolveAgentReleasePromptTier,
  type AgentReleasePromptTier,
} from '@/lib/agent-installations/harden-release-snapshot'
import { redactAgentReleaseVariableValues } from '@/lib/agent-installations/redact-release-variables'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { resolvePrincipalWorkflowContext } from '@/lib/workflows/application/principal-scope'
import { buildWorkflowExportPayload } from '@/lib/workflows/operations/export-workflow'
import type { Variable } from '@/stores/variables/types'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('PublishAgentRelease')

/** URL-safe share token length; unique index on agent_release.share_token. */
const SHARE_TOKEN_LENGTH = 32

export interface PublishAgentReleaseInput {
  workflowId: string
  assertedWorkspaceId?: string
  /**
   * C2 prompt tier. Default `retain` (App Store needs prompts). Pass
   * `strip-system` to clear system prompts; env `AGENT_RELEASE_STRIP_SYSTEM_PROMPTS=true`
   * forces strip when omitted.
   */
  promptTier?: AgentReleasePromptTier
}

export interface PublishAgentReleaseResult {
  releaseId: string
  workflowId: string
  workspaceId: string
  /** Tenant stamp copied from the author's workspace (null = personal). */
  organizationId: string | null
  version: number
  shareToken: string
  /** Absolute Install-by-link URL for the author to share. */
  shareUrl: string
  createdAt: string
  /** Active installations on older releases of this workflow marked pending. */
  installationsMarkedPending: number
  /** Older releases whose share tokens were invalidated by this Publish. */
  sharesRevoked: number
  /** Effective C2 prompt policy applied to this release snapshot. */
  promptTier: AgentReleasePromptTier
}

/**
 * Session Publish → AgentRelease: sanitized workflow snapshot + share token URL.
 *
 * Uses the same redaction path as export (`sanitizeWorkflowForSharing` via
 * `buildWorkflowExportPayload`) so author secrets never land in the release,
 * then strips workflow variable *values* (H1), hardens the snapshot (C2/H2/H5),
 * and on Publish N+1 marks non-revoked installations pinned to older releases
 * as `pending` and revokes older share tokens (H4) so only the newest Install
 * link works.
 */
export const publishAgentRelease = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.publish,
  resolveContext: resolvePrincipalWorkflowContext<PublishAgentReleaseInput>,
  async execute({ principal, context, input }): Promise<PublishAgentReleaseResult> {
    const createdBy = resolvePrincipalSubjectUserId(principal)
    if (!createdBy) {
      throw new OrchestrationError('forbidden', 'Publish requires a signed-in user')
    }

    const payload = await buildWorkflowExportPayload(context.workflow)
    if (!payload) {
      throw new OrchestrationError('not_found', 'Workflow state not found')
    }

    const promptTier = resolveAgentReleasePromptTier(input.promptTier)
    const releaseState = hardenAgentReleaseSnapshot(
      {
        ...payload.state,
        variables: redactAgentReleaseVariableValues(
          payload.state.variables as Record<string, Variable> | undefined
        ),
      } as Partial<WorkflowState>,
      { promptTier }
    )

    const releaseId = generateId()
    const shareToken = generateShortId(SHARE_TOKEN_LENGTH)

    const result = await db.transaction(async (tx) => {
      const [latest] = await tx
        .select({ version: max(agentRelease.version) })
        .from(agentRelease)
        .where(eq(agentRelease.workflowId, context.workflowId))

      const version = (latest?.version ?? 0) + 1
      const createdAt = new Date()

      await tx.insert(agentRelease).values({
        id: releaseId,
        workflowId: context.workflowId,
        organizationId: context.workspaceOrganizationId,
        version,
        state: releaseState,
        shareToken,
        createdBy,
        createdAt,
      })

      const olderReleaseIds = await tx
        .select({ id: agentRelease.id })
        .from(agentRelease)
        .where(
          and(eq(agentRelease.workflowId, context.workflowId), ne(agentRelease.id, releaseId))
        )

      let installationsMarkedPending = 0
      let sharesRevoked = 0
      if (olderReleaseIds.length > 0) {
        const olderIds = olderReleaseIds.map((row) => row.id)
        const marked = await tx
          .update(agentInstallation)
          .set({ updatePolicy: 'pending', updatedAt: createdAt })
          .where(
            and(
              isNull(agentInstallation.revokedAt),
              inArray(agentInstallation.releaseId, olderIds)
            )
          )
          .returning({ id: agentInstallation.id })
        installationsMarkedPending = marked.length

        const revoked = await tx
          .update(agentRelease)
          .set({ shareRevokedAt: createdAt })
          .where(and(inArray(agentRelease.id, olderIds), isNull(agentRelease.shareRevokedAt)))
          .returning({ id: agentRelease.id })
        sharesRevoked = revoked.length
      }

      return { version, createdAt, installationsMarkedPending, sharesRevoked }
    })

    const shareUrl = `${getBaseUrl()}/install/${shareToken}`

    logger.info('Published agent release', {
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      organizationId: context.workspaceOrganizationId,
      releaseId,
      version: result.version,
      promptTier,
      installationsMarkedPending: result.installationsMarkedPending,
      sharesRevoked: result.sharesRevoked,
      principalKind: principal.kind,
    })

    return {
      releaseId,
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      organizationId: context.workspaceOrganizationId,
      version: result.version,
      shareToken,
      shareUrl,
      createdAt: result.createdAt.toISOString(),
      installationsMarkedPending: result.installationsMarkedPending,
      sharesRevoked: result.sharesRevoked,
      promptTier,
    }
  },
})
