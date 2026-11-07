import type { Metadata } from 'next'
import { cn, pageHeadingClassName } from '@sim/emcn'

export const metadata: Metadata = {
  title: 'Мои приложения',
  robots: { index: false },
}

export const dynamic = 'force-dynamic'

/**
 * Installations welcome: sidebar lists apps; pane empty until one is opened.
 */
export default function WorkspaceAppsHomePage() {
  return (
    <div className='flex h-full min-h-0 flex-col items-center justify-center bg-[var(--bg)] px-6 text-center text-[var(--text-primary)]'>
      <h1 className={cn(pageHeadingClassName)}>Мои приложения</h1>
      <p className='mt-2 max-w-md text-[var(--text-muted)] text-sm'>
        Выберите приложение слева — откроется чат с ним. Редактор сценариев здесь не нужен.
      </p>
    </div>
  )
}
