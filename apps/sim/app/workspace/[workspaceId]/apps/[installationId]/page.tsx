import { Suspense } from 'react'
import type { Metadata } from 'next'
import { ChatLoadingState } from '@/app/(interfaces)/chat/components'
import { InstallationChat } from '@/app/installations/[installationId]/chat/installation-chat'

export const metadata: Metadata = {
  title: 'Приложение',
  robots: { index: false },
}

export const dynamic = 'force-dynamic'

interface WorkspaceAppsInstallationPageProps {
  params: Promise<{ workspaceId: string; installationId: string }>
}

export default async function WorkspaceAppsInstallationPage({
  params,
}: WorkspaceAppsInstallationPageProps) {
  const { installationId } = await params

  return (
    <Suspense fallback={<ChatLoadingState />}>
      <InstallationChat installationId={installationId} />
    </Suspense>
  )
}
