'use client'

import { Badge, Banner, Button } from '@sim/emcn'
import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/auth/client'
import { appsInstallationPath } from '@/lib/navigation/installation-paths'
import {
  useAcceptAgentInstallationUpdate,
  useDeferAgentInstallationUpdate,
  usePendingAgentInstallationUpdates,
} from '@/hooks/queries/agent-installations'

/**
 * Session badge for pending agent Installation updates (Publish N+1 channel).
 * Workspace chrome; agent-home also surfaces Accept/Defer in /apps rail + pane (U4).
 */
export function AgentInstallationUpdatesBanner() {
  const router = useRouter()
  const { data: session, isPending } = useSession()
  const enabled = Boolean(session?.user) && !isPending
  const { data, isLoading } = usePendingAgentInstallationUpdates({ enabled })
  const acceptMutation = useAcceptAgentInstallationUpdate()
  const deferMutation = useDeferAgentInstallationUpdate()

  const updates = data?.updates ?? []
  if (!enabled || isLoading || updates.length === 0) {
    return null
  }

  const busy = acceptMutation.isPending || deferMutation.isPending

  return (
    <Banner role='status' className='border-b border-[var(--border)]'>
      <div className='mx-auto flex max-w-[1400px] flex-col gap-2'>
        {updates.map((update) => (
          <div
            key={update.installationId}
            className='flex flex-wrap items-center gap-3 text-[var(--text-body)] text-small'
          >
            <Badge variant='amber' size='sm'>
              есть обновление
            </Badge>
            <span className='min-w-0'>
              <span className='text-[var(--text-primary)]'>{update.workflowName}</span>
              {' · '}
              v{update.pinnedVersion} → v{update.latestVersion}
            </span>
            <div className='ml-auto flex flex-wrap items-center gap-2'>
              <Button
                type='button'
                size='sm'
                variant='default'
                disabled={busy}
                onClick={() => void acceptMutation.mutateAsync(update.installationId)}
              >
                Accept
              </Button>
              <Button
                type='button'
                size='sm'
                variant='ghost'
                disabled={busy}
                onClick={() => void deferMutation.mutateAsync(update.installationId)}
              >
                Defer
              </Button>
              <Button
                type='button'
                size='sm'
                variant='ghost'
                onClick={() =>
                  router.push(
                    appsInstallationPath(update.installationId, { title: update.workflowName })
                  )
                }
              >
                Чат
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Banner>
  )
}
