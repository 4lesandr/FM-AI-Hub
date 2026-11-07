'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  Chip,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  Tooltip,
  toast,
  writeTextToClipboard,
} from '@sim/emcn'
import { Check, Duplicate, Link } from '@sim/emcn/icons'
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

const COPY_FEEDBACK_MS = 2000

/**
 * Editor Publish chip: session POST → AgentRelease, then show/copy Install share link.
 * Same Chip / ChipModal chrome as Deploy and file share.
 */
export function Publish({ activeWorkflowId, userPermissions, disabled = false }: PublishProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [release, setRelease] = useState<PublishAgentReleaseResponse | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const installLinkRef = useRef<HTMLInputElement>(null)
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hydrationPhase = useWorkflowRegistry((state) => state.hydration.phase)
  const isRegistryLoading = hydrationPhase === 'idle' || hydrationPhase === 'state-loading'
  const { hasBlocks } = useCurrentWorkflow()
  const publishMutation = usePublishAgentRelease()

  const isEmpty = !hasBlocks()
  const canPublish = userPermissions.canEdit
  const isPublishing = publishMutation.isPending
  const isDisabled = disabled || isPublishing || !canPublish || isEmpty || !activeWorkflowId

  const shareUrl = release?.shareUrl ?? ''

  useEffect(
    () => () => {
      if (copyResetRef.current) clearTimeout(copyResetRef.current)
    },
    []
  )

  const copyInstallLink = useCallback(async () => {
    if (!shareUrl) return
    try {
      // writeTextToClipboard falls back on http stands (Clipboard API needs secure context).
      await writeTextToClipboard(shareUrl)
      setLinkCopied(true)
      if (copyResetRef.current) clearTimeout(copyResetRef.current)
      copyResetRef.current = setTimeout(() => setLinkCopied(false), COPY_FEEDBACK_MS)
    } catch {
      toast({ message: 'Не скопировалось — выделите ссылку и скопируйте вручную' })
      const input = installLinkRef.current
      if (input) {
        input.focus()
        input.select()
      }
    }
  }, [shareUrl])

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
            type='custom'
            title='Install link'
            hint='Org-bound Install link. Secrets/ENV names redacted; prompts are shared IP (use promptTier strip-system to clear system prompts).'
          >
            {(aria) => (
              <ChipInput
                ref={installLinkRef}
                readOnly
                value={shareUrl}
                inputClassName='cursor-text select-all'
                endAdornment={
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <Button
                        type='button'
                        variant='quiet'
                        size='icon'
                        onClick={() => void copyInstallLink()}
                        aria-label='Copy install link'
                      >
                        {linkCopied ? (
                          <Check className='size-[13px]' />
                        ) : (
                          <Duplicate className='size-[13px]' />
                        )}
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                      {linkCopied ? 'Copied!' : 'Copy install link'}
                    </Tooltip.Content>
                  </Tooltip.Root>
                }
                {...aria}
              />
            )}
          </ChipModalField>
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
                        leftIcon={linkCopied ? Check : Link}
                        onClick={() => void copyInstallLink()}
                      >
                        {linkCopied ? 'Copied!' : 'Copy link'}
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
