import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Мои приложения',
  robots: { index: false },
}

export const dynamic = 'force-dynamic'

/**
 * Agent home welcome: rail lists Installations; pane is empty until one is opened.
 */
export default function AppsHomePage() {
  return (
    <div className='light flex h-full min-h-0 flex-col items-center justify-center bg-[var(--bg)] px-6 text-center text-[var(--text-primary)]'>
      <h1 className='font-medium text-[20px] text-[var(--text-primary)]'>Мои приложения</h1>
      <p className='mt-2 max-w-md text-[var(--text-muted)] text-sm'>
        Выберите приложение в сайдбаре, чтобы открыть чат. Консоль workflow здесь не нужна —
        это сторона агента после Install.
      </p>
    </div>
  )
}
