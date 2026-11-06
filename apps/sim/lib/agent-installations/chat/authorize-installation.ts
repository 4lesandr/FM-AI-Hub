import { resolvePrincipalSubjectUserId, type SessionPrincipal } from '@sim/auth/principal'
import { agentInstallation, db } from '@sim/db'
import { and, eq, isNull } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export interface AuthorizedInstallation {
  installationId: string
  userId: string
  workspaceId: string | null
}

/**
 * Session may chat only on own active (non-revoked) Installation.
 * Identity = installer; revoked → not_found (no leakage).
 */
export async function authorizeOwnActiveInstallation(
  principal: SessionPrincipal,
  installationIdRaw: string
): Promise<AuthorizedInstallation> {
  const userId = resolvePrincipalSubjectUserId(principal)
  if (!userId) {
    throw new OrchestrationError('forbidden', 'Chat requires a signed-in user')
  }

  const installationId = installationIdRaw.trim()
  if (!installationId) {
    throw new OrchestrationError('validation', 'Installation id is required')
  }

  const [row] = await db
    .select({
      installationId: agentInstallation.id,
      userId: agentInstallation.userId,
      workspaceId: agentInstallation.workspaceId,
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

  if (!row) {
    throw new OrchestrationError('not_found', 'Installation not found')
  }

  return {
    installationId: row.installationId,
    userId: row.userId,
    workspaceId: row.workspaceId,
  }
}
