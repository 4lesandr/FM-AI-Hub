import { agentInstallation, db } from '@sim/db'
import { and, eq, isNull } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { getActiveOrganizationId } from '@/lib/auth/session-response'
import { listWorkspacesForViewer } from '@/lib/workspaces/list'

type AppSession = NonNullable<Awaited<ReturnType<typeof getSession>>>
import {
  appsHomePath,
  appsInstallationPath,
  legacyAppsHomePath,
  legacyAppsInstallationPath,
} from '@/lib/navigation/installation-paths'

function pickWorkspaceId(
  preferred: string | null | undefined,
  accessibleIds: Set<string>,
  lastActiveWorkspaceId: string | null
): string | null {
  if (preferred && accessibleIds.has(preferred)) return preferred
  if (lastActiveWorkspaceId && accessibleIds.has(lastActiveWorkspaceId)) {
    return lastActiveWorkspaceId
  }
  return accessibleIds.values().next().value ?? null
}

async function listViewerWorkspaces(session: AppSession) {
  return listWorkspacesForViewer({
    userId: session.user.id,
    activeOrganizationId: getActiveOrganizationId(session),
  })
}

export async function resolveAgentAppsHomeDestination(session: AppSession): Promise<string> {
  const { workspaces, lastActiveWorkspaceId } = await listViewerWorkspaces(session)
  const accessibleIds = new Set(workspaces.map((workspace) => workspace.id))
  const workspaceId = pickWorkspaceId(null, accessibleIds, lastActiveWorkspaceId)
  return workspaceId ? appsHomePath(workspaceId) : '/workspace'
}

export async function resolveAgentAppsInstallationDestination(
  session: AppSession,
  installationId: string,
  title?: string | null
): Promise<string> {
  const userId = session.user.id
  const normalizedTitle = title?.trim() || undefined

  const [installation] = await db
    .select({ workspaceId: agentInstallation.workspaceId })
    .from(agentInstallation)
    .where(
      and(
        eq(agentInstallation.id, installationId),
        eq(agentInstallation.userId, userId),
        isNull(agentInstallation.revokedAt)
      )
    )
    .limit(1)

  const { workspaces, lastActiveWorkspaceId } = await listViewerWorkspaces(session)
  const accessibleIds = new Set(workspaces.map((workspace) => workspace.id))
  const workspaceId = pickWorkspaceId(
    installation?.workspaceId,
    accessibleIds,
    lastActiveWorkspaceId
  )

  if (workspaceId) {
    return appsInstallationPath(workspaceId, installationId, { title: normalizedTitle })
  }

  return legacyAppsInstallationPath(installationId, { title: normalizedTitle })
}
