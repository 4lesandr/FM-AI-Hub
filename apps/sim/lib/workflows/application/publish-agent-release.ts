import { resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { agentInstallation, agentRelease, db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { generateId, generateShortId } from '@sim/utils/id'
import { and, eq, inArray, isNull, max, ne } from 'drizzle-orm'
import { redactAgentReleaseVariableValues } from '@/lib/agent-installations/redact-release-variables'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { resolvePrincipalWorkflowContext } from '@/lib/workflows/application/principal-scope'
import { buildWorkflowExportPayload } from '@/lib/workflows/operations/export-workflow'
import type { Variable } from '@/stores/variables/types'

const logger = createLogger('PublishAgentRelease')

/** URL-safe share token length; unique index on agent_release.share_token. */
const SHARE_TOKEN_LENGTH = 32

export interface PublishAgentReleaseInput {
  workflowId: string
  assertedWorkspaceId?: string
}

export interface PublishAgentReleaseResult {
  releaseId: string
  workflowId: string
  workspaceId: string
  version: number
  shareToken: string
  /** Absolute Install-by-link URL for the author to share. */
  shareUrl: string
  createdAt: string
  /** Active installations on older releases of this workflow marked pending. */
  installationsMarkedPending: number
  /** Older releases whose share tokens were invalidated by this Publish. */
  sharesRevoked: number
}

/**
 * Session Publish → AgentRelease: sanitized workflow snapshot + share token URL.
 *
 * Uses the same redaction path as export (`sanitizeWorkflowForSharing` via
 * `buildWorkflowExportPayload`) so author secrets never land in the release,
 * then strips workflow variable *values* (H1). Publish N+1 marks non-revoked
 * installations pinned to older releases as `pending` and revokes older share
 * tokens (H4) so only the newest Install link works.
 */
export const publishAgentRelease = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.publish,
  resolveContext: resolvePrincipalWorkflowContext<PublishAgentReleaseInput>,
  async execute({ principal, context }): Promise<PublishAgentReleaseResult> {
    const createdBy = resolvePrincipalSubjectUserId(principal)
    if (!createdBy) {
      throw new OrchestrationError('forbidden', 'Publish requires a signed-in user')
    }

    const payload = await buildWorkflowExportPayload(context.workflow)
    if (!payload) {
      throw new OrchestrationError('not_found', 'Workflow state not found')
    }

    const releaseState = {
      ...payload.state,
      variables: redactAgentReleaseVariableValues(
        payload.state.variables as Record<string, Variable> | undefined
      ),
    }

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
      releaseId,
      version: result.version,
      installationsMarkedPending: result.installationsMarkedPending,
      sharesRevoked: result.sharesRevoked,
      principalKind: principal.kind,
    })

    return {
      releaseId,
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      version: result.version,
      shareToken,
      shareUrl,
      createdAt: result.createdAt.toISOString(),
      installationsMarkedPending: result.installationsMarkedPending,
      sharesRevoked: result.sharesRevoked,
    }
  },
})
