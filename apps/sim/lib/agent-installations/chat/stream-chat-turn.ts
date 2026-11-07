import type { SessionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { authorizeOwnActiveInstallation } from '@/lib/agent-installations/chat/authorize-installation'
import { chunkTextForStream } from '@/lib/agent-installations/chat/format-assistant-content'
import { runInstallationPaneTurn } from '@/lib/agent-installations/chat/pane-turn-runner'
import {
  appendInstallationThreadMessage,
  getOrCreateInstallationThread,
} from '@/lib/agent-installations/chat/thread-store'
import { SSE_HEADERS, encodeSSE } from '@/lib/core/utils/sse'
import type { ChatStreamFrame } from '@/lib/workflows/streaming/agent-stream-protocol'
import {
  AGENT_STREAM_PROTOCOL_HEADER,
  AGENT_STREAM_PROTOCOL_V1,
} from '@/lib/workflows/streaming/agent-stream-protocol'

const logger = createLogger('InstallationChat.StreamTurn')

const ASSISTANT_BLOCK_ID = 'installation-agent'

export interface StreamInstallationChatTurnInput {
  principal: SessionPrincipal
  installationId: string
  message: string
  requestId: string
  abortSignal?: AbortSignal
  requestHeaders?: Headers
}

function encodeFrame(frame: ChatStreamFrame | '[DONE]'): Uint8Array {
  if (frame === '[DONE]') {
    return new TextEncoder().encode('data: [DONE]\n\n')
  }
  return encodeSSE(frame)
}

/**
 * Stream one Installation pane turn over agent-events-v1 SSE.
 *
 * Owns: authorize → thread persist → SSE (tool frames + answer chunks + final).
 * Turn body lives in `runInstallationPaneTurn` (C1 replaces that seam only).
 * Pane UI (`InstallationChat` in `/apps/{id}`) already consumes this protocol.
 */
export async function createInstallationChatTurnStream(
  input: StreamInstallationChatTurnInput
): Promise<Response> {
  const message = input.message.trim()
  if (!message) {
    return Response.json({ error: 'Message is required' }, { status: 400 })
  }

  const installation = await authorizeOwnActiveInstallation(input.principal, input.installationId)
  const thread = await getOrCreateInstallationThread({
    installationId: installation.installationId,
    userId: installation.userId,
  })

  await appendInstallationThreadMessage({
    threadId: thread.id,
    role: 'user',
    content: message,
  })

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (frame: ChatStreamFrame | '[DONE]') => {
        controller.enqueue(encodeFrame(frame))
      }

      let assistantContent = ''
      const openToolIds = new Map<string, string>()

      try {
        const turn = await runInstallationPaneTurn({
          principal: input.principal,
          installationId: installation.installationId,
          workspaceId: installation.workspaceId,
          message,
          requestId: input.requestId,
          abortSignal: input.abortSignal,
          requestHeaders: input.requestHeaders,
          onToolEvent: (event) => {
            if (event.phase === 'start') {
              const toolCallId = generateId()
              openToolIds.set(event.name, toolCallId)
              enqueue({
                blockId: ASSISTANT_BLOCK_ID,
                event: 'tool',
                phase: 'start',
                id: toolCallId,
                name: event.name,
              })
              return
            }

            const toolCallId = openToolIds.get(event.name) ?? generateId()
            openToolIds.delete(event.name)
            const result = event.result
            const toolStatus =
              result &&
              result.ok &&
              (result.status === 'completed' || result.status === 'paused')
                ? 'success'
                : 'error'
            enqueue({
              blockId: ASSISTANT_BLOCK_ID,
              event: 'tool',
              phase: 'end',
              id: toolCallId,
              name: event.name,
              status: toolStatus,
            })
          },
        })

        assistantContent = turn.assistantContent

        for (const chunk of chunkTextForStream(assistantContent)) {
          if (input.abortSignal?.aborted) break
          enqueue({ blockId: ASSISTANT_BLOCK_ID, chunk })
        }

        await appendInstallationThreadMessage({
          threadId: thread.id,
          role: 'assistant',
          content: assistantContent,
        })

        enqueue({
          event: 'final',
          data: {
            success: turn.success,
            threadId: thread.id,
            installationId: installation.installationId,
          },
        })
        enqueue('[DONE]')
        controller.close()
      } catch (error) {
        if (input.abortSignal?.aborted) {
          logger.info('Installation chat turn aborted', {
            installationId: installation.installationId,
            threadId: thread.id,
          })
          controller.close()
          return
        }

        const errorText =
          error instanceof Error ? error.message : 'Installation chat turn failed'
        logger.error('Installation chat turn failed', {
          installationId: installation.installationId,
          threadId: thread.id,
          error: errorText,
        })

        try {
          if (!assistantContent) {
            assistantContent = errorText
            await appendInstallationThreadMessage({
              threadId: thread.id,
              role: 'assistant',
              content: assistantContent,
            })
          }
          enqueue({
            blockId: ASSISTANT_BLOCK_ID,
            event: 'error',
            error: errorText,
          })
          enqueue('[DONE]')
        } catch {
          // ignore secondary failures while closing the stream
        }
        controller.close()
      }
    },
  })

  const headers = new Headers(SSE_HEADERS)
  headers.set(AGENT_STREAM_PROTOCOL_HEADER, AGENT_STREAM_PROTOCOL_V1)
  headers.set('X-Installation-Thread-Id', thread.id)

  return new Response(stream, { status: 200, headers })
}
