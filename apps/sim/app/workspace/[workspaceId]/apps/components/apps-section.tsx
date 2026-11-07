'use client'

import { Badge, chipVariants, cn, DropdownMenuItem, OverflowText } from '@sim/emcn'
import { Box } from '@sim/emcn/icons'
import Link from 'next/link'
import { appsHomePath, appsInstallationPath } from '@/lib/navigation/installation-paths'
import { InstallationUpdateControls } from '@/app/workspace/[workspaceId]/apps/components/installation-update-controls'
import {
  CollapsedSidebarMenu,
  SidebarSection,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components'
import {
  SIDEBAR_ITEM_GAP_CLASS,
  SIDEBAR_SECTION_GAP_CLASS,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import { useHoverMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-hover-menu'
import {
  useAgentInstallations,
  usePendingAgentInstallationUpdates,
} from '@/hooks/queries/agent-installations'

interface AppsSectionProps {
  workspaceId: string
  isCollapsed: boolean
  pathname: string | null
}

function isCurrentInstallation(
  pathname: string | null,
  workspaceId: string,
  installationId: string
): boolean {
  if (!pathname) return false
  const base = `${appsHomePath(workspaceId)}/${installationId}`
  return pathname === base || pathname.startsWith(`${base}/`)
}

/**
 * Workspace rail section: active Installations from session list API.
 */
export function AppsSection({ workspaceId, isCollapsed, pathname }: AppsSectionProps) {
  const hover = useHoverMenu()
  const { data, isLoading } = useAgentInstallations()
  const { data: pendingData } = usePendingAgentInstallationUpdates()
  const installations = data?.installations ?? []
  const pendingById = new Map(
    (pendingData?.updates ?? []).map((update) => [update.installationId, update])
  )

  return (
    <SidebarSection
      title='Приложения'
      railCollapsed={isCollapsed}
      className={cn(SIDEBAR_SECTION_GAP_CLASS, 'apps-section shrink-0')}
    >
      {isCollapsed ? (
        <div className='px-2'>
          <CollapsedSidebarMenu
            icon={<Box className='size-[16px] shrink-0 text-[var(--text-icon)]' />}
            hover={hover}
            ariaLabel='Приложения'
          >
            {isLoading ? null : installations.length === 0 ? (
              <DropdownMenuItem disabled>Нет приложений</DropdownMenuItem>
            ) : (
              installations.map((installation) => {
                const href = appsInstallationPath(workspaceId, installation.id, {
                  title: installation.name,
                })
                const active = isCurrentInstallation(pathname, workspaceId, installation.id)
                return (
                  <DropdownMenuItem key={installation.id} asChild>
                    <Link href={href} aria-current={active ? 'page' : undefined}>
                      <OverflowText label={installation.name} className='flex-1' />
                      {installation.pendingUpdate ? (
                        <Badge variant='amber' size='sm' dot className='shrink-0'>
                          обновление
                        </Badge>
                      ) : null}
                    </Link>
                  </DropdownMenuItem>
                )
              })
            )}
            <DropdownMenuItem asChild>
              <Link href={appsHomePath(workspaceId)}>Все приложения</Link>
            </DropdownMenuItem>
          </CollapsedSidebarMenu>
        </div>
      ) : (
        <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>
          {!isLoading && installations.length === 0 && (
            <div className='flex h-[30px] items-center px-2 text-[var(--text-muted)] text-small'>
              Нет приложений
            </div>
          )}
          {!isLoading &&
            installations.map((installation) => {
              const href = appsInstallationPath(workspaceId, installation.id, {
                title: installation.name,
              })
              const active = isCurrentInstallation(pathname, workspaceId, installation.id)
              const pending = pendingById.get(installation.id)
              return (
                <div key={installation.id} className='flex flex-col gap-0.5'>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      chipVariants({ active, fullWidth: true }),
                      'flex h-[30px] items-center gap-1.5 px-2'
                    )}
                  >
                    <OverflowText
                      label={installation.name}
                      className='min-w-0 flex-1 text-[var(--text-body)]'
                    />
                    {installation.pendingUpdate ? (
                      <Badge variant='amber' size='sm' dot className='shrink-0'>
                        обновление
                      </Badge>
                    ) : null}
                  </Link>
                  {pending ? (
                    <InstallationUpdateControls
                      compact
                      workspaceId={workspaceId}
                      installationId={pending.installationId}
                      pinnedVersion={pending.pinnedVersion}
                      latestVersion={pending.latestVersion}
                    />
                  ) : null}
                </div>
              )
            })}
        </div>
      )}
    </SidebarSection>
  )
}
