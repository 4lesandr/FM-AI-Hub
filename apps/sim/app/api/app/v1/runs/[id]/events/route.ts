import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  agentsApiErrorResponse,
  assertRunInScope,
  authenticateAgentsApiRequest,
  refreshRunFromExecutionLog,
} from '@/lib/fvks/agents-api'
import { getAgentsApiRun } from '@/lib/fvks/agents-api/run-store'

const logger = createLogger('FvksAgentsApiEvents')
const PING_MS = 15_000
const POLL_MS = 1_500

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

function encodeNamedEvent(type: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
}

/**
 * GET /api/app/v1/runs/:id/events — SSE: text / changed / ping (FMAH wire format).
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await context.params
      const { assertion, principal } = await authenticateAgentsApiRequest(request)
      await assertRunInScope(principal, assertion, id)

      let closed = false
      let lastStatus = ''
      let lastOutput = ''
      let emittedOffset = 0
      let pollTimer: ReturnType<typeof setInterval> | undefined
      let pingTimer: ReturnType<typeof setInterval> | undefined

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const cleanup = () => {
            if (pollTimer) clearInterval(pollTimer)
            if (pingTimer) clearInterval(pingTimer)
          }

          const close = () => {
            if (closed) return
            closed = true
            cleanup()
            try {
              controller.close()
            } catch {
              /* already closed */
            }
          }

          const push = (type: string, data: unknown) => {
            if (closed) return
            try {
              controller.enqueue(encodeNamedEvent(type, data))
            } catch (error) {
              logger.debug('SSE enqueue failed', {
                error: error instanceof Error ? error.message : String(error),
              })
              close()
            }
          }

          const tick = async () => {
            if (closed) return
            try {
              const record = await getAgentsApiRun(id)
              if (!record) {
                close()
                return
              }
              const refreshed = await refreshRunFromExecutionLog(record)
              if (refreshed.status !== lastStatus) {
                lastStatus = refreshed.status
                push('changed', { type: 'changed' })
              }
              const output = refreshed.output ?? ''
              if (output.length > emittedOffset) {
                const chunk = output.slice(emittedOffset)
                push('text', { type: 'text', offset: emittedOffset, text: chunk })
                emittedOffset = output.length
                lastOutput = output
              } else if (output !== lastOutput && output.length > 0) {
                lastOutput = output
                push('changed', { type: 'changed' })
              }
              if (
                refreshed.status === 'succeeded' ||
                refreshed.status === 'failed' ||
                refreshed.status === 'cancelled'
              ) {
                push('changed', { type: 'changed' })
                close()
              }
            } catch (error) {
              logger.warn('SSE poll failed', {
                runId: id,
                error: error instanceof Error ? error.message : String(error),
              })
            }
          }

          request.signal.addEventListener('abort', close)

          push('changed', { type: 'changed' })
          void tick()
          pollTimer = setInterval(() => {
            void tick()
          }, POLL_MS)
          pingTimer = setInterval(() => {
            push('ping', {})
          }, PING_MS)
        },
        cancel() {
          closed = true
          if (pollTimer) clearInterval(pollTimer)
          if (pingTimer) clearInterval(pingTimer)
        },
      })

      return new NextResponse(stream, {
        status: 200,
        headers: {
          ...SSE_HEADERS,
          'Content-Type': 'text/event-stream; charset=utf-8',
        },
      })
    } catch (error) {
      return agentsApiErrorResponse(error)
    }
  }
)
