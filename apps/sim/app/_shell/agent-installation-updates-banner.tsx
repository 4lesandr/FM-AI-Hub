'use client'

import { Badge, Banner, Button } from '@sim/emcn'
import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/auth/client'
import {
  appsInstallationPath,
  legacyAppsInstallationPath,
} from '@/lib/navigation/installation-paths'
import {
  useAcceptAgentInstallationUpdate,
  useDeferAgentInstallationUpdate,
  usePendingAgentInstallationUpdates,
} from '@/hooks/queries/agent-installations'

function chatHrefForUpdate(update: {
  installationId: string
  workflowName: string
  workspaceId: string | null
}): string {
  if (update.workspaceId) {
    return appsInstallationPath(update.workspaceId, update.installationId, {
      title: update.workflowName,
    })
  }
  return legacyAppsInstallationPath(update.installationId, { title: update.workflowName })
}

/**
 * Session badge for pending agent Installation updates (Publish N+1 channel).
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

  const handleAccept = async (update: (typeof updates)[number]) => {
    try {
      const result = await acceptMutation.mutateAsync(update.installationId)
      if (result.installationId !== update.installationId && update.workspaceId) {
        router.push(
          appsInstallationPath(update.workspaceId, result.installationId, {
            title: update.workflowName,
          })
        )
      }
    } catch {
      // surfaced via mutation error state
    }
  }

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
                onClick={() => void handleAccept(update)}
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
                onClick={() => router.push(chatHrefForUpdate(update))}
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
