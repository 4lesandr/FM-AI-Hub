'use client'

import { useState } from 'react'
import {
  Chip,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  Tooltip,
  toast,
  useCopyToClipboard,
} from '@sim/emcn'
import { Check, Link } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import type { PublishAgentReleaseResponse } from '@/lib/api/contracts/agent-releases'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-current-workflow'
import { usePublishAgentRelease } from '@/hooks/queries/agent-installations'
import type { WorkspaceUserPermissions } from '@/hooks/use-user-permissions'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface PublishProps {
  activeWorkflowId: string | null
  userPermissions: WorkspaceUserPermissions
  disabled?: boolean
}

/**
 * Editor Publish chip: session POST → AgentRelease, then show/copy Install share link.
 * Same Chip / ChipModal chrome as Deploy and file share.
 */
export function Publish({ activeWorkflowId, userPermissions, disabled = false }: PublishProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [release, setRelease] = useState<PublishAgentReleaseResponse | null>(null)
  const hydrationPhase = useWorkflowRegistry((state) => state.hydration.phase)
  const isRegistryLoading = hydrationPhase === 'idle' || hydrationPhase === 'state-loading'
  const { hasBlocks } = useCurrentWorkflow()
  const publishMutation = usePublishAgentRelease()
  const { copied, copy } = useCopyToClipboard()

  const isEmpty = !hasBlocks()
  const canPublish = userPermissions.canEdit
  const isPublishing = publishMutation.isPending
  const isDisabled = disabled || isPublishing || !canPublish || isEmpty || !activeWorkflowId

  const getTooltipText = () => {
    if (isEmpty) return 'Cannot publish an empty workflow'
    if (!canPublish) return 'Write permissions required'
    if (disabled) return 'Workflow is locked'
    if (isPublishing) return 'Publishing...'
    return 'Publish Install-by-link edition'
  }

  const runPublish = async () => {
    if (isRegistryLoading || isDisabled || !activeWorkflowId) return

    try {
      const result = await publishMutation.mutateAsync(activeWorkflowId)
      setRelease(result)
      setIsModalOpen(true)
    } catch (error) {
      toast({ message: getErrorMessage(error, 'Failed to publish agent release') })
    }
  }

  useRegisterGlobalCommands(() => [
    {
      id: 'publish-workflow',
      handler: () => {
        if (isRegistryLoading || isDisabled) {
          toast({ message: isRegistryLoading ? 'Workflow is still loading' : getTooltipText() })
          return
        }
        void runPublish()
      },
    },
  ])

  const handleClose = () => {
    setIsModalOpen(false)
  }

  const shareUrl = release?.shareUrl ?? ''

  return (
    <>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className='inline-flex'>
            <Chip
              mobileCompact
              variant='border'
              onClick={() => void runPublish()}
              disabled={isRegistryLoading || isDisabled}
            >
              {isPublishing ? 'Publishing...' : 'Publish'}
            </Chip>
          </span>
        </Tooltip.Trigger>
        <Tooltip.Content>{getTooltipText()}</Tooltip.Content>
      </Tooltip.Root>

      <ChipModal
        open={isModalOpen && Boolean(release)}
        onOpenChange={(open) => {
          if (!open) handleClose()
        }}
        size='sm'
        srTitle='Published agent release'
      >
        <ChipModalHeader onClose={handleClose}>
          {release ? `Published v${release.version}` : 'Published'}
        </ChipModalHeader>
        <ChipModalBody>
          <ChipModalField
            type='copy'
            title='Install link'
            hint='Org-bound Install link. Secrets/ENV names redacted; prompts are shared IP (use promptTier strip-system to clear system prompts).'
            value={shareUrl}
            copyLabel='Copy install link'
          />
        </ChipModalBody>
        <ChipModalFooter
          onCancel={handleClose}
          defaultAction='primary'
          secondaryActions={
            shareUrl
              ? [
                  {
                    custom: (
                      <Chip
                        leftIcon={copied ? Check : Link}
                        onClick={() => {
                          void copy(shareUrl)
                        }}
                      >
                        {copied ? 'Copied!' : 'Copy link'}
                      </Chip>
                    ),
                  },
                ]
              : undefined
          }
          primaryAction={{
            label: isPublishing ? 'Publishing...' : 'Publish again',
            onClick: () => void runPublish(),
            disabled: isRegistryLoading || isDisabled,
          }}
        />
      </ChipModal>
    </>
  )
}
