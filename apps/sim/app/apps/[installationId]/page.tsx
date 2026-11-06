import { Suspense } from 'react'
import type { Metadata } from 'next'
import { ChatLoadingState } from '@/app/(interfaces)/chat/components'
import { InstallationChat } from '@/app/installations/[installationId]/chat/installation-chat'

export const metadata: Metadata = {
  title: 'Приложение',
  robots: { index: false },
}

export const dynamic = 'force-dynamic'

interface AppsInstallationPageProps {
  params: Promise<{ installationId: string }>
}

export default async function AppsInstallationPage({ params }: AppsInstallationPageProps) {
  const { installationId } = await params

  return (
    <Suspense fallback={<ChatLoadingState />}>
      <InstallationChat installationId={installationId} />
    </Suspense>
  )
}
