import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { legacyAppsHomePath } from '@/lib/navigation/installation-paths'
import { resolveAgentAppsHomeDestination } from '@/lib/navigation/resolve-agent-apps-destination.server'

export const dynamic = 'force-dynamic'

/** Legacy `/apps` → workspace Installations home. */
export default async function LegacyAppsHomeRedirect() {
  const session = await getSession()
  if (!session?.user) {
    redirect(
      buildAuthCrossLink('/login', {
        callbackUrl: legacyAppsHomePath(),
        isInviteFlow: false,
      })
    )
  }

  redirect(await resolveAgentAppsHomeDestination(session))
}
