import { db, member, workflow, workspace } from '@sim/db'
import { and, eq } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

/**
 * FLOMNI / SaaS-safe Install-by-link gate (C1):
 * - Org-bound workspace → installer must be a member of that organization
 *   (or already have permission on the author's workspace).
 * - Personal / non-org workspace → installer must have permission on the
 *   author's workspace (same-workspace collaborators only).
 *
 * Cross-org Install on a shared instance is forbidden.
 */
export async function assertInstallerMayResolveShare(params: {
  installerUserId: string
  workflowId: string
}): Promise<void> {
  const [row] = await db
    .select({
      workspaceId: workflow.workspaceId,
      organizationId: workspace.organizationId,
    })
    .from(workflow)
    .innerJoin(workspace, eq(workspace.id, workflow.workspaceId))
    .where(eq(workflow.id, params.workflowId))
    .limit(1)

  if (!row?.workspaceId) {
    throw new OrchestrationError('not_found', 'Agent release not found for this share token')
  }

  const workspacePermission = await getUserEntityPermissions(
    params.installerUserId,
    'workspace',
    row.workspaceId
  )
  if (workspacePermission) return

  if (row.organizationId) {
    const [membership] = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.userId, params.installerUserId),
          eq(member.organizationId, row.organizationId)
        )
      )
      .limit(1)
    if (membership) return
  }

  // not_found (not forbidden): do not confirm that a foreign-org token is valid.
  throw new OrchestrationError('not_found', 'Agent release not found for this share token')
}
