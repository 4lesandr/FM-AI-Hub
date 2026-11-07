'use client'

import { Badge, Button, cn } from '@sim/emcn'
import { useRouter } from 'next/navigation'
import { appsInstallationPath } from '@/lib/navigation/installation-paths'
import {
  useAcceptAgentInstallationUpdate,
  useDeferAgentInstallationUpdate,
} from '@/hooks/queries/agent-installations'

export interface InstallationUpdateControlsProps {
  workspaceId: string
  installationId: string
  pinnedVersion: number
  latestVersion: number
  /** Compact row for sidebar; default is chat-header strip. */
  compact?: boolean
  className?: string
}

/**
 * Accept / Defer for a pending Installation update in the workspace shell.
 */
export function InstallationUpdateControls({
  workspaceId,
  installationId,
  pinnedVersion,
  latestVersion,
  compact = false,
  className,
}: InstallationUpdateControlsProps) {
  const router = useRouter()
  const acceptMutation = useAcceptAgentInstallationUpdate()
  const deferMutation = useDeferAgentInstallationUpdate()
  const busy = acceptMutation.isPending || deferMutation.isPending

  const handleAccept = async () => {
    try {
      const result = await acceptMutation.mutateAsync(installationId)
      if (result.installationId !== installationId) {
        router.replace(
          appsInstallationPath(workspaceId, result.installationId, { title: null })
        )
      }
    } catch {
      // mutation error surfaces via React Query state
    }
  }

  const handleDefer = async () => {
    try {
      await deferMutation.mutateAsync(installationId)
    } catch {
      // mutation error surfaces via React Query state
    }
  }

  return (
    <div
      role='status'
      className={cn(
        'flex flex-wrap items-center gap-2 text-[var(--text-body)] text-small',
        compact ? 'px-2 pb-1' : 'border-b border-[var(--border)] px-4 py-2',
        className
      )}
      onClick={(event) => event.preventDefault()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Badge variant='amber' size='sm' dot>
        есть обновление
      </Badge>
      <span className='min-w-0 text-[var(--text-muted)]'>
        v{pinnedVersion} → v{latestVersion}
      </span>
      <div className={cn('flex flex-wrap items-center gap-1.5', compact ? '' : 'ml-auto')}>
        <Button
          type='button'
          size='sm'
          variant='default'
          disabled={busy}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void handleAccept()
          }}
        >
          Accept
        </Button>
        <Button
          type='button'
          size='sm'
          variant='ghost'
          disabled={busy}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void handleDefer()
          }}
        >
          Defer
        </Button>
      </div>
    </div>
  )
}
