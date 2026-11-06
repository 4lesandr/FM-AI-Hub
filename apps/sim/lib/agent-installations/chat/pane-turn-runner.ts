import type { SessionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import {
  runInstallationAgentLoop,
  type InstallationAgentDecide,
} from '@/lib/agent-installations/chat/agent-loop'
import type { RunInstallationToolResult } from '@/lib/agent-installations/chat/tools'

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
   * Agent loop may produce this without calling run_installation.
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
  /** Test / future LLM hook — defaults to MVP decide inside the loop. */
  decide?: InstallationAgentDecide
}

/**
 * Body of one Installation pane turn (C4 UI glue → C1 agent loop).
 *
 * Runs the minimal agent loop (system prompt + tool calls via
 * `dispatchInstallationAgentTool`). Not a one-shot UI/execute path.
 * Keep emitting `onToolEvent` and returning `{ assistantContent, success }`.
 */
export async function runInstallationPaneTurn(
  input: RunInstallationPaneTurnInput
): Promise<PaneTurnResult> {
  logger.info('Pane turn via Installation agent loop', {
    installationId: input.installationId,
    requestId: input.requestId,
  })

  const turn = await runInstallationAgentLoop({
    context: {
      principal: input.principal,
      installationId: input.installationId,
      requestId: input.requestId,
      abortSignal: input.abortSignal,
      requestHeaders: input.requestHeaders,
    },
    message: input.message,
    decide: input.decide,
    onToolEvent: input.onToolEvent,
  })

  return {
    assistantContent: turn.assistantContent,
    success: turn.success,
  }
}
