import { Suspense } from 'react'
import type { Metadata } from 'next'
import { AuthStack, AuthSkeleton as Skeleton } from '@sim/auth-ui'
import { InstallByToken } from '@/app/install/[token]/install-by-token'
import InstallLayout from '@/app/install/components/layout'

export const metadata: Metadata = {
  title: 'Поставить себе',
  robots: { index: false },
}

export const dynamic = 'force-dynamic'

function InstallLoading() {
  return (
    <InstallLayout>
      <AuthStack>
        <div className='au:space-y-1'>
          <Skeleton shape='title' className='au:w-[200px]' />
          <Skeleton shape='label' className='au:w-[280px]' />
        </div>
        <Skeleton />
      </AuthStack>
    </InstallLayout>
  )
}

export default function InstallByTokenPage() {
  return (
    <Suspense fallback={<InstallLoading />}>
      <InstallByToken />
    </Suspense>
  )
}
