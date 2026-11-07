import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { legacyAppsInstallationPath } from '@/lib/navigation/installation-paths'
import { resolveAgentAppsInstallationDestination } from '@/lib/navigation/resolve-agent-apps-destination.server'

export const dynamic = 'force-dynamic'

interface LegacyAppsInstallationRedirectProps {
  params: Promise<{ installationId: string }>
  searchParams: Promise<{ title?: string }>
}

/** Legacy `/apps/[installationId]` → workspace Installation chat pane. */
export default async function LegacyAppsInstallationRedirect({
  params,
  searchParams,
}: LegacyAppsInstallationRedirectProps) {
  const session = await getSession()
  const { installationId } = await params
  const { title } = await searchParams

  if (!session?.user) {
    redirect(
      buildAuthCrossLink('/login', {
        callbackUrl: legacyAppsInstallationPath(installationId, { title }),
        isInviteFlow: false,
      })
    )
  }

  redirect(await resolveAgentAppsInstallationDestination(session, installationId, title))
}
