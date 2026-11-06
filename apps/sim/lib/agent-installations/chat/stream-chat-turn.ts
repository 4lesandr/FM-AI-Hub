import type { SessionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { authorizeOwnActiveInstallation } from '@/lib/agent-installations/chat/authorize-installation'
import {
  chunkTextForStream,
  formatInstallationAssistantContent,
} from '@/lib/agent-installations/chat/format-assistant-content'
import {
  appendInstallationThreadMessage,
  getOrCreateInstallationThread,
} from '@/lib/agent-installations/chat/thread-store'
import {
  dispatchInstallationAgentTool,
  RUN_INSTALLATION_TOOL_NAME,
} from '@/lib/agent-installations/chat/tools'
import { SSE_HEADERS, encodeSSE } from '@/lib/core/utils/sse'
import type { ChatStreamFrame } from '@/lib/workflows/streaming/agent-stream-protocol'
import { AGENT_STREAM_PROTOCOL_HEADER, AGENT_STREAM_PROTOCOL_V1 } from '@/lib/workflows/streaming/agent-stream-protocol'

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
 * C3 stream turn for the Installation pane.
 *
 * Persists user + assistant messages on InstallationThread, then emits
 * agent-events-v1 SSE (tool frames + answer chunks) so `useChatStreaming` works.
 *
 * Turn body (until C1 LLM loop lands): call C2 `run_installation` under
 * installer identity and stream the tool result as assistant text. C1 replaces
 * the model loop; this route/persistence stay.
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

      const toolCallId = generateId()
      let assistantContent = ''

      try {
        enqueue({
          blockId: ASSISTANT_BLOCK_ID,
          event: 'tool',
          phase: 'start',
          id: toolCallId,
          name: RUN_INSTALLATION_TOOL_NAME,
        })

        const toolResult = await dispatchInstallationAgentTool({
          context: {
            principal: input.principal,
            installationId: installation.installationId,
            requestId: input.requestId,
            abortSignal: input.abortSignal,
            requestHeaders: input.requestHeaders,
          },
          name: RUN_INSTALLATION_TOOL_NAME,
          arguments: {
            input: { input: message },
          },
        })

        const toolStatus =
          toolResult.ok &&
          (toolResult.status === 'completed' || toolResult.status === 'paused')
            ? 'success'
            : 'error'

        enqueue({
          blockId: ASSISTANT_BLOCK_ID,
          event: 'tool',
          phase: 'end',
          id: toolCallId,
          name: RUN_INSTALLATION_TOOL_NAME,
          status: toolStatus,
        })

        if (!toolResult.ok) {
          assistantContent = toolResult.error || 'Installation run failed'
        } else if (toolResult.error) {
          assistantContent =
            typeof toolResult.error === 'string'
              ? toolResult.error
              : formatInstallationAssistantContent(toolResult.error) ||
                `Статус: ${toolResult.status}`
        } else {
          assistantContent =
            formatInstallationAssistantContent(toolResult.output) ||
            (toolResult.status === 'completed' ? 'Готово.' : `Статус: ${toolResult.status}`)
        }

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
            success: toolResult.ok && toolStatus === 'success',
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
