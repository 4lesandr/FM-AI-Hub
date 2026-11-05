import { AuthShell, SupportFooter } from '@/app/(auth)/components'

interface InstallLayoutProps {
  children: React.ReactNode
}

/**
 * Install-by-link pages share the auth shell with invite — logo header, centered
 * column, support footer — so the share-link flow matches the rest of Sim chrome.
 */
export default function InstallLayout({ children }: InstallLayoutProps) {
  return <AuthShell footer={<SupportFooter />}>{children}</AuthShell>
}
