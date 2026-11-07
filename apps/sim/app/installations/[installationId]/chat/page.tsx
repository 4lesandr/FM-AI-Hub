import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { legacyInstallationChatPath } from '@/lib/navigation/installation-paths'
import { resolveAgentAppsInstallationDestination } from '@/lib/navigation/resolve-agent-apps-destination.server'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'

export const metadata: Metadata = {
  title: 'Installation chat',
  robots: { index: false },
}

export const dynamic = 'force-dynamic'

interface LegacyInstallationChatRedirectProps {
  params: Promise<{ installationId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Legacy `/installations/{id}/chat` → workspace Installation pane.
 */
export default async function LegacyInstallationChatRedirect({
  params,
  searchParams,
}: LegacyInstallationChatRedirectProps) {
  const session = await getSession()
  const { installationId } = await params
  const query = await searchParams
  const titleRaw = query.title
  const title = typeof titleRaw === 'string' ? titleRaw : Array.isArray(titleRaw) ? titleRaw[0] : null

  if (!session?.user) {
    redirect(
      buildAuthCrossLink('/login', {
        callbackUrl: legacyInstallationChatPath(installationId, { title }),
        isInviteFlow: false,
      })
    )
  }

  redirect(await resolveAgentAppsInstallationDestination(session, installationId, title))
}
