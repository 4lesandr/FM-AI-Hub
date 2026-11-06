import type { SessionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { formatInstallationAssistantContent } from '@/lib/agent-installations/chat/format-assistant-content'
import {
  dispatchInstallationAgentTool,
  RUN_INSTALLATION_TOOL_NAME,
  type RunInstallationToolResult,
} from '@/lib/agent-installations/chat/tools'

const logger = createLogger('InstallationChat.PaneTurnRunner')

export type PaneTurnToolPhase = 'start' | 'end'

export interface PaneTurnToolEvent {
  phase: PaneTurnToolPhase
  name: string
  /** Present on `end`. */
  result?: RunInstallationToolResult
}

export interface PaneTurnResult {
  /**
   * Assistant text streamed to the pane after tools complete.
   * C1 LLM loop may produce this without calling run_installation.
   */
  assistantContent: string
  /** Overall turn success for the final SSE frame. */
  success: boolean
}

export interface RunInstallationPaneTurnInput {
  principal: SessionPrincipal
  installationId: string
  message: string
  requestId: string
  abortSignal?: AbortSignal
  requestHeaders?: Headers
  /** Live tool lifecycle for SSE (same protocol the pane already understands). */
  onToolEvent?: (event: PaneTurnToolEvent) => void
}

function assistantTextFromToolResult(toolResult: RunInstallationToolResult): string {
  if (!toolResult.ok) {
    return toolResult.error || 'Installation run failed'
  }
  if (toolResult.error) {
    return (
      (typeof toolResult.error === 'string'
        ? toolResult.error
        : formatInstallationAssistantContent(toolResult.error)) || `Статус: ${toolResult.status}`
    )
  }
  return (
    formatInstallationAssistantContent(toolResult.output) ||
    (toolResult.status === 'completed' ? 'Готово.' : `Статус: ${toolResult.status}`)
  )
}

/**
 * Body of one Installation pane turn (C4 UI glue seam for C1).
 *
 * Until C1 lands: one-shot `run_installation` under installer identity.
 * C1 replaces this function with the LLM + tool loop; keep emitting `onToolEvent`
 * and returning `{ assistantContent, success }` so stream + pane UI stay unchanged.
 */
export async function runInstallationPaneTurn(
  input: RunInstallationPaneTurnInput
): Promise<PaneTurnResult> {
  logger.info('Pane turn via run_installation fallback (pre-C1 loop)', {
    installationId: input.installationId,
    requestId: input.requestId,
  })

  input.onToolEvent?.({ phase: 'start', name: RUN_INSTALLATION_TOOL_NAME })

  const toolResult = await dispatchInstallationAgentTool({
    context: {
      principal: input.principal,
      installationId: input.installationId,
      requestId: input.requestId,
      abortSignal: input.abortSignal,
      requestHeaders: input.requestHeaders,
    },
    name: RUN_INSTALLATION_TOOL_NAME,
    arguments: {
      input: { input: input.message },
    },
  })

  input.onToolEvent?.({
    phase: 'end',
    name: RUN_INSTALLATION_TOOL_NAME,
    result: toolResult,
  })

  const success =
    toolResult.ok && (toolResult.status === 'completed' || toolResult.status === 'paused')

  return {
    assistantContent: assistantTextFromToolResult(toolResult),
    success,
  }
}
