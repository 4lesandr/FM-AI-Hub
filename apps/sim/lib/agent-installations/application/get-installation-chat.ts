import type { SessionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { authorizeOwnActiveInstallation } from '@/lib/agent-installations/chat/authorize-installation'
import {
  getOrCreateInstallationThread,
  listInstallationThreadMessages,
} from '@/lib/agent-installations/chat/thread-store'
import { defineOperation } from '@/lib/core/application'
import { defineAuthorizedCredentialUserUseCase } from '@/lib/credentials/application/authorized-user-use-case'

const logger = createLogger('GetInstallationChat')

export interface GetInstallationChatInput {
  installationId: string
}

export interface InstallationChatMessageDto {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface GetInstallationChatResult {
  installationId: string
  threadId: string
  messages: InstallationChatMessageDto[]
}

/**
 * Load (or create) the active InstallationThread and its history for the pane.
 * Survives reload — not client-only React state.
 */
export const getInstallationChat = defineAuthorizedCredentialUserUseCase({
  // permission-group-exempt: reads only the caller's own Installation thread.
  operation: defineOperation({
    id: 'agent_installations.chat.get',
    principalKinds: ['session'],
    capability: 'none',
  }),
  async execute({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: GetInstallationChatInput
  }): Promise<GetInstallationChatResult> {
    const installation = await authorizeOwnActiveInstallation(principal, input.installationId)
    const thread = await getOrCreateInstallationThread({
      installationId: installation.installationId,
      userId: installation.userId,
    })
    const rows = await listInstallationThreadMessages(thread.id)

    logger.info('Loaded Installation chat history', {
      installationId: installation.installationId,
      threadId: thread.id,
      messageCount: rows.length,
    })

    return {
      installationId: installation.installationId,
      threadId: thread.id,
      messages: rows.map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        createdAt: row.createdAt.toISOString(),
      })),
    }
  },
})
