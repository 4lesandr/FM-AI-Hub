'use client'

import { memo, useRef, useState } from 'react'
import { Chip, cn, scrollFadeAttributes, scrollFadeClass, useScrollEdges } from '@sim/emcn'
import { PanelLeft } from '@sim/emcn/icons'
import { usePathname, useRouter } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { isMacPlatform } from '@/lib/core/utils/platform'
import { DOCS_URL, SLACK_COMMUNITY_URL } from '@/lib/help-links'
import { appsHomePath } from '@/lib/navigation/installation-paths'
import { captureEvent } from '@/lib/posthog/client'
import { AppsSection } from '@/app/apps/components/apps-section'
import { useSidebarChrome } from '@/app/workspace/[workspaceId]/components/workspace-chrome'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { createCommands } from '@/app/workspace/[workspaceId]/utils/commands'
import {
  HelpModal,
  SidebarFooter,
  SidebarTooltip,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components'
import {
  SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
  SIDEBAR_DIVIDER_PAD_BELOW_CLASS,
  SIDEBAR_SECTION_GAP_CLASS,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import { useSidebarResize } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { isSidebarBackgroundClick } from '@/app/workspace/[workspaceId]/w/components/sidebar/utils'
import Link from 'next/link'

const DRAG_EXEMPT_CLASS = '[-webkit-app-region:no-drag]'
const ACCOUNT_SETTINGS_HREF = '/account/settings'

/**
 * Light agent-home rail: header + Installations («Приложения») + shared footer.
 * Reuses WorkspaceChrome collapse/resize/peek; not org mothership Chats.
 */
export const AgentAppsSidebar = memo(function AgentAppsSidebar() {
  const { isCollapsed: railCollapsed, isPeeking, onToggle: toggleCollapsed } = useSidebarChrome()
  const isCollapsed = railCollapsed && !isPeeking

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)
  const pathname = usePathname()
  const router = useRouter()
  const posthog = usePostHog()
  const { handlePointerDown } = useSidebarResize()
  const showCollapsedTooltips = isCollapsed
  const scrollEdges = useScrollEdges(scrollContainerRef, {
    contentRef: scrollContentRef,
    enabled: !isCollapsed,
  })
  const isMac = isMacPlatform()
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false)

  const handleOpenDocs = () => {
    window.open(DOCS_URL, '_blank', 'noopener,noreferrer')
    captureEvent(posthog, 'docs_opened', { source: 'help_menu' })
  }

  const handleOpenSlackCommunity = () => {
    window.open(SLACK_COMMUNITY_URL, '_blank', 'noopener,noreferrer')
    captureEvent(posthog, 'slack_community_opened', { source: 'help_menu' })
  }

  const handleEdgeKeyDown = (e: React.KeyboardEvent) => {
    if (isCollapsed && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      toggleCollapsed()
    }
  }

  const handleSidebarClick = (event: React.MouseEvent<HTMLElement>) => {
    if (!isSidebarBackgroundClick(event)) return
  }

  useRegisterGlobalCommands(() =>
    createCommands([
      {
        id: 'toggle-sidebar',
        handler: () => {
          toggleCollapsed()
        },
      },
    ])
  )

  return (
    <div className='relative h-full'>
      <aside
        className='group/rail sidebar-container relative h-full overflow-hidden bg-[var(--surface-1)] [&_.group.cursor-pointer]:duration-0'
        data-collapsed={isCollapsed || undefined}
        aria-label='Приложения'
        onClick={handleSidebarClick}
      >
        <div className='flex h-full flex-col'>
          {!isPeeking && (
            <div
              aria-hidden
              className='desktop-window-drag-region desktop-workspace-window-drag-region h-[var(--desktop-title-bar-height)]'
            />
          )}
          <div
            className={cn(
              'relative flex shrink-0 items-center px-2 pt-2',
              !isPeeking &&
                '[[data-sim-desktop-title-bar=inset]_&]:pt-[var(--desktop-title-bar-height)]'
            )}
          >
            <div className='flex min-w-0 flex-1 items-center px-2'>
              <Link
                href={appsHomePath()}
                className={cn(
                  DRAG_EXEMPT_CLASS,
                  'sidebar-collapse-hide truncate font-medium text-[var(--text-primary)] text-sm'
                )}
              >
                Мои приложения
              </Link>
            </div>
            <div
              inert={isCollapsed}
              className={cn(
                'flex h-[30px] items-center gap-[1px] overflow-hidden max-md:hidden',
                isCollapsed
                  ? 'w-0 opacity-0'
                  : 'w-[32px] [[data-sim-desktop-title-bar=inset]_&]:w-0'
              )}
            >
              <SidebarTooltip
                label='Свернуть сайдбар'
                enabled={!isCollapsed}
                side='bottom'
                shortcut={isMac ? '⌘B' : 'Ctrl+B'}
              >
                <Chip
                  leftIcon={PanelLeft}
                  aria-label='Свернуть сайдбар'
                  onClick={toggleCollapsed}
                  tabIndex={isCollapsed ? -1 : undefined}
                  className={cn(
                    DRAG_EXEMPT_CLASS,
                    'max-md:hidden [[data-sim-desktop-title-bar=inset]_&]:hidden'
                  )}
                />
              </SidebarTooltip>
            </div>
          </div>

          <div
            ref={scrollContainerRef}
            className={cn(
              SIDEBAR_DIVIDER_PAD_BELOW_CLASS,
              SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
              SIDEBAR_SECTION_GAP_CLASS,
              scrollFadeClass,
              'flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden'
            )}
            {...scrollFadeAttributes(scrollEdges)}
          >
            <div ref={scrollContentRef} className='flex flex-col'>
              <AppsSection isCollapsed={isCollapsed} pathname={pathname} />
            </div>
          </div>

          <SidebarFooter
            showDivider={scrollEdges.bottom}
            isCollapsed={isCollapsed}
            showCollapsedTooltips={showCollapsedTooltips}
            accountSettingsHref={ACCOUNT_SETTINGS_HREF}
            onOpenAccountSettings={() => router.push(ACCOUNT_SETTINGS_HREF)}
            navigationLinks={[]}
            onOpenDocs={handleOpenDocs}
            onJoinSlack={handleOpenSlackCommunity}
            onContactSupport={() => setIsHelpModalOpen(true)}
          />
        </div>
      </aside>

      <HelpModal open={isHelpModalOpen} onOpenChange={setIsHelpModalOpen} />

      {!isPeeking && (
        <div
          className={cn(
            'absolute top-0 right-0 bottom-0 z-20 hidden w-[8px] translate-x-1/2 md:block',
            isCollapsed ? 'cursor-e-resize' : 'cursor-ew-resize'
          )}
          onPointerDown={isCollapsed ? undefined : handlePointerDown}
          onClick={isCollapsed ? toggleCollapsed : undefined}
          onKeyDown={handleEdgeKeyDown}
          role={isCollapsed ? 'button' : 'separator'}
          tabIndex={0}
          aria-orientation={isCollapsed ? undefined : 'vertical'}
          aria-label={isCollapsed ? 'Развернуть сайдбар' : 'Изменить ширину сайдбара'}
        />
      )}
    </div>
  )
})
