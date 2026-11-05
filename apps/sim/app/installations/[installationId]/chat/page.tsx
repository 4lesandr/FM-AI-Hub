import { Suspense } from 'react'
import type { Metadata } from 'next'
import { InterfacesShell } from '@/app/(interfaces)/components'
import { ChatLoadingState } from '@/app/(interfaces)/chat/components'
import { InstallationChat } from '@/app/installations/[installationId]/chat/installation-chat'

export const metadata: Metadata = {
  title: 'Installation chat',
  robots: { index: false },
}

export const dynamic = 'force-dynamic'

interface InstallationChatPageProps {
  params: Promise<{ installationId: string }>
}

export default async function InstallationChatPage({ params }: InstallationChatPageProps) {
  const { installationId } = await params

  return (
    <Suspense
      fallback={
        <InterfacesShell>
          <ChatLoadingState />
        </InterfacesShell>
      }
    >
      <InstallationChat installationId={installationId} />
    </Suspense>
  )
}
