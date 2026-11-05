import { Suspense } from 'react'
import type { Metadata } from 'next'
import { InstallByToken } from '@/app/install/[token]/install-by-token'

export const metadata: Metadata = {
  title: 'Install agent',
  robots: { index: false },
}

export const dynamic = 'force-dynamic'

export default function InstallByTokenPage() {
  return (
    <Suspense fallback={<p style={{ padding: 24 }}>Loading…</p>}>
      <InstallByToken />
    </Suspense>
  )
}
