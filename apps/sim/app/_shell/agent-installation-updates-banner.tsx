'use client'

import { useSession } from '@/lib/auth/client'
import {
  useAcceptAgentInstallationUpdate,
  useDeferAgentInstallationUpdate,
  usePendingAgentInstallationUpdates,
} from '@/hooks/queries/agent-installations'

/**
 * Session badge for pending agent Installation updates (Publish N+1 channel).
 * Minimal Affordance — no catalog; Accept/Defer only.
 */
export function AgentInstallationUpdatesBanner() {
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
    <div
      role='status'
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 60,
        background: '#fff8e1',
        borderBottom: '1px solid #c9a227',
        padding: '10px 16px',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 14,
      }}
    >
      {updates.map((update) => (
        <div
          key={update.installationId}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            alignItems: 'center',
            marginBottom: updates.length > 1 ? 8 : 0,
          }}
        >
          <span
            style={{
              display: 'inline-block',
              padding: '2px 8px',
              borderRadius: 4,
              background: '#c9a227',
              color: '#1a1a1a',
              fontWeight: 600,
              fontSize: 12,
            }}
          >
            есть обновление
          </span>
          <span>
            <strong>{update.workflowName}</strong> · v{update.pinnedVersion} → v
            {update.latestVersion}
          </span>
          <button
            type='button'
            disabled={busy}
            onClick={() => void acceptMutation.mutateAsync(update.installationId)}
          >
            Accept
          </button>
          <button
            type='button'
            disabled={busy}
            onClick={() => void deferMutation.mutateAsync(update.installationId)}
          >
            Defer
          </button>
        </div>
      ))}
    </div>
  )
}
