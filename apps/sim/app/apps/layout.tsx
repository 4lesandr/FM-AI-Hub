import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { appsHomePath } from '@/lib/navigation/installation-paths'
import { AgentAppsSidebar } from '@/app/apps/components'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import {
  WorkspaceChrome,
  WorkspaceViewport,
} from '@/app/workspace/[workspaceId]/components/workspace-chrome'
import { GlobalCommandsProvider } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'

/**
 * Agent-home shell (U2): WorkspaceChrome + Installations rail.
 * Chat engine lives in the content pane (`/apps/{installationId}`); not org Chats.
 */
export default async function AppsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session?.user) {
    redirect(
      buildAuthCrossLink('/login', {
        callbackUrl: appsHomePath(),
        isInviteFlow: false,
      })
    )
  }

  const cookieStore = await cookies()
  const initialSidebarCollapsed = cookieStore.get('sidebar_collapsed')?.value === '1'

  return (
    <GlobalCommandsProvider>
      <WorkspaceViewport className='workspace-root'>
        <WorkspaceChrome
          sidebar={<AgentAppsSidebar />}
          initialSidebarCollapsed={initialSidebarCollapsed}
        >
          {children}
        </WorkspaceChrome>
      </WorkspaceViewport>
    </GlobalCommandsProvider>
  )
}
