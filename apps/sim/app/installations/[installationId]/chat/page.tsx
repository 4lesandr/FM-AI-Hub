import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { appsInstallationPath } from '@/lib/navigation/installation-paths'

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
 * U3: deep link `/installations/{id}/chat` → agent home `/apps/{id}` (rail + chat).
 * Keeps `title` query when present. Publisher `/workspace/.../w/...` is untouched.
 */
export default async function LegacyInstallationChatRedirect({
  params,
  searchParams,
}: LegacyInstallationChatRedirectProps) {
  const { installationId } = await params
  const query = await searchParams
  const titleRaw = query.title
  const title = typeof titleRaw === 'string' ? titleRaw : Array.isArray(titleRaw) ? titleRaw[0] : null

  redirect(appsInstallationPath(installationId, { title }))
}
