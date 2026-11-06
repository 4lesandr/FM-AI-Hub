import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { formatInstallationAssistantContent } from '@/lib/agent-installations/chat/format-assistant-content'
import {
  dispatchInstallationAgentTool,
  installationAgentToolDefinitions,
  RUN_INSTALLATION_TOOL_NAME,
  stringifyInstallationAgentToolResult,
  type RunInstallationToolContext,
  type RunInstallationToolResult,
} from '@/lib/agent-installations/chat/tools'

const logger = createLogger('InstallationChat.AgentLoop')

/** Max model→tool→model rounds per pane turn (MVP). */
export const INSTALLATION_AGENT_MAX_STEPS = 4

/**
 * System prompt for the Installation pane agent (product face = our agent + tools).
 * Pinned workflow is a capability (`run_installation`), not the sole chat face.
 */
export const INSTALLATION_AGENT_SYSTEM_PROMPT = [
  'You are the FM AI Hub agent for one Installation pane.',
  'Identity: installer (session user of this Installation). Never act as the Release author.',
  'Never reveal author secrets, credentialBindings, or raw release state.',
  'Tools:',
  `- ${RUN_INSTALLATION_TOOL_NAME}: run the pinned published workflow under installer identity.`,
  'You may answer without tools for greetings, help, or capability questions.',
  'When the user wants the app/capability to run, call run_installation.',
].join(' ')

export type InstallationAgentToolCall = {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export type InstallationAgentLoopMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | {
      role: 'assistant'
      content: string | null
      toolCalls?: InstallationAgentToolCall[]
    }
  | { role: 'tool'; toolCallId: string; name: string; content: string }

export type InstallationAgentDecideResult =
  | { type: 'assistant'; content: string }
  | { type: 'tool_calls'; toolCalls: InstallationAgentToolCall[] }

export type InstallationAgentDecide = (input: {
  messages: InstallationAgentLoopMessage[]
  tools: typeof installationAgentToolDefinitions
}) => Promise<InstallationAgentDecideResult>

export type InstallationAgentLoopToolEvent = {
  phase: 'start' | 'end'
  name: string
  result?: RunInstallationToolResult
}

export interface RunInstallationAgentLoopInput {
  context: RunInstallationToolContext
  message: string
  /** Injectable model step (tests / future LLM). Default = MVP heuristic. */
  decide?: InstallationAgentDecide
  onToolEvent?: (event: InstallationAgentLoopToolEvent) => void
  maxSteps?: number
}

export interface RunInstallationAgentLoopResult {
  assistantContent: string
  success: boolean
  toolResults: RunInstallationToolResult[]
  steps: number
}

function lastUserText(messages: InstallationAgentLoopMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'user') return msg.content
  }
  return ''
}

function lastToolPayload(
  messages: InstallationAgentLoopMessage[]
): RunInstallationToolResult | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'tool') continue
    try {
      return JSON.parse(msg.content) as RunInstallationToolResult
    } catch {
      return null
    }
  }
  return null
}

function isMetaOnlyUserMessage(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (!t) return true
  if (t.length > 80) return false
  // No trailing \b: JS \w is ASCII-only, so Cyrillic phrases never get a word-boundary.
  return /^(привет|hello|hi|hey|help|помощь|что ты умеешь|кто ты|what can you do|capabilities)([!?.]|$)/.test(
    t
  )
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
 * MVP decide (no mothership/copilot): meta → text; after tool → format result;
 * otherwise emit `run_installation` tool call for the loop to dispatch.
 */
export async function defaultInstallationAgentDecide(input: {
  messages: InstallationAgentLoopMessage[]
  tools: typeof installationAgentToolDefinitions
}): Promise<InstallationAgentDecideResult> {
  void input.tools
  const toolResult = lastToolPayload(input.messages)
  if (toolResult) {
    return { type: 'assistant', content: assistantTextFromToolResult(toolResult) }
  }

  const userText = lastUserText(input.messages)
  if (isMetaOnlyUserMessage(userText)) {
    return {
      type: 'assistant',
      content:
        'Я агент этого приложения (Installation). Могу ответить сам или вызвать tool ' +
        `\`${RUN_INSTALLATION_TOOL_NAME}\` — запуск закреплённого workflow под вашей identity installer.`,
    }
  }

  return {
    type: 'tool_calls',
    toolCalls: [
      {
        id: `call_${generateId()}`,
        name: RUN_INSTALLATION_TOOL_NAME,
        arguments: { input: { input: userText } },
      },
    ],
  }
}

function toolSuccess(result: RunInstallationToolResult): boolean {
  return result.ok && (result.status === 'completed' || result.status === 'paused')
}

/**
 * Minimal Installation agent loop: system prompt → decide → optional tool calls
 * via `dispatchInstallationAgentTool` (not a one-shot UI/execute path).
 */
export async function runInstallationAgentLoop(
  input: RunInstallationAgentLoopInput
): Promise<RunInstallationAgentLoopResult> {
  const decide = input.decide ?? defaultInstallationAgentDecide
  const maxSteps = input.maxSteps ?? INSTALLATION_AGENT_MAX_STEPS
  const message = input.message.trim()

  const messages: InstallationAgentLoopMessage[] = [
    { role: 'system', content: INSTALLATION_AGENT_SYSTEM_PROMPT },
    { role: 'user', content: message },
  ]

  const toolResults: RunInstallationToolResult[] = []
  let steps = 0

  logger.info('Installation agent loop start', {
    installationId: input.context.installationId,
    requestId: input.context.requestId,
  })

  for (let step = 0; step < maxSteps; step++) {
    steps = step + 1
    if (input.context.abortSignal?.aborted) {
      return {
        assistantContent: 'Прервано.',
        success: false,
        toolResults,
        steps,
      }
    }

    const decision = await decide({
      messages,
      tools: installationAgentToolDefinitions,
    })

    if (decision.type === 'assistant') {
      const success =
        toolResults.length === 0 ? true : toolResults.every((r) => toolSuccess(r))
      return {
        assistantContent: decision.content,
        success,
        toolResults,
        steps,
      }
    }

    messages.push({
      role: 'assistant',
      content: null,
      toolCalls: decision.toolCalls,
    })

    for (const call of decision.toolCalls) {
      input.onToolEvent?.({ phase: 'start', name: call.name })

      const toolResult = await dispatchInstallationAgentTool({
        context: input.context,
        name: call.name,
        arguments: call.arguments,
      })

      toolResults.push(toolResult)
      input.onToolEvent?.({ phase: 'end', name: call.name, result: toolResult })

      messages.push({
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: stringifyInstallationAgentToolResult(toolResult),
      })
    }
  }

  const last = toolResults[toolResults.length - 1]
  return {
    assistantContent: last
      ? assistantTextFromToolResult(last)
      : 'Не удалось завершить ход агента.',
    success: last ? toolSuccess(last) : false,
    toolResults,
    steps,
  }
}
