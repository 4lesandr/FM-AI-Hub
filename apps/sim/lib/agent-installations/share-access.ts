import { agentRelease, db, member, workflow, workspace } from '@sim/db'
import { and, eq, exists, isNull, or, sql, type SQL } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

/**
 * SQL tenant prefilter for agent_release reads (sec4):
 * - Org-stamped release → installer must be a member of that organization
 * - Personal / null organizationId → pass through; application check still
 *   requires author-workspace permission
 *
 * Cross-org token probing returns empty/not_found without confirming validity.
 */
export function agentReleaseVisibleToInstaller(installerUserId: string): SQL | undefined {
  return or(
    isNull(agentRelease.organizationId),
    exists(
      db
        .select({ found: sql`1` })
        .from(member)
        .where(
          and(
            eq(member.userId, installerUserId),
            eq(member.organizationId, agentRelease.organizationId)
          )
        )
    )
  )
}

/**
 * FLOMNI / SaaS-safe Install-by-link gate (C1 + sec4):
 * Prefer denormalized `agent_release.organization_id` when provided; otherwise
 * fall back to the live workflow→workspace join (legacy rows / callers).
 * - Org-bound → installer must be a member (or already have author-workspace permission).
 * - Personal / non-org → installer must have permission on the author's workspace.
 */
export async function assertInstallerMayResolveShare(params: {
  installerUserId: string
  workflowId: string
  /** Tenant stamped on agent_release at Publish; preferred over live workspace join. */
  releaseOrganizationId?: string | null
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

  const organizationId =
    params.releaseOrganizationId !== undefined
      ? params.releaseOrganizationId
      : row.organizationId

  const workspacePermission = await getUserEntityPermissions(
    params.installerUserId,
    'workspace',
    row.workspaceId
  )
  if (workspacePermission) return

  if (organizationId) {
    const [membership] = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.userId, params.installerUserId),
          eq(member.organizationId, organizationId)
        )
      )
      .limit(1)
    if (membership) return
  }

  // not_found (not forbidden): do not confirm that a foreign-org token is valid.
  throw new OrchestrationError('not_found', 'Agent release not found for this share token')
}
