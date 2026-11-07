import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { generateId } from '@sim/utils/id'
import { getBYOKKey } from '@/lib/api-key/byok'
import { getRotatingApiKey } from '@/lib/core/config/api-keys'
import { env } from '@/lib/core/config/env'
import { isHosted } from '@/lib/core/config/env-flags'
import {
  defaultInstallationAgentDecide,
  type InstallationAgentDecide,
  type InstallationAgentDecideResult,
  type InstallationAgentLoopMessage,
  type InstallationAgentToolCall,
} from '@/lib/agent-installations/chat/agent-loop'
import {
  installationAgentToolDefinitions,
  RUN_INSTALLATION_TOOL_NAME,
} from '@/lib/agent-installations/chat/tools'
import { getProviderDefaultModel } from '@/providers/models'
import { adaptOpenAIChatToolSchema } from '@/providers/tool-schema-adapter'
import {
  buildResponsesInputFromMessages,
  convertToolsToResponses,
  extractResponseText,
  extractResponseToolCalls,
} from '@/providers/openai/utils'
import { fetchWithProviderRetry } from '@/providers/retry'
import { parseToolArguments } from '@/providers/streaming-tool-loop-shared'
import type { Message, ProviderToolConfig } from '@/providers/types'
import { getProviderFromModel, prepareToolsWithUsageControl } from '@/providers/utils'
import type { BYOKProviderId } from '@/tools/types'

const logger = createLogger('InstallationChat.LlmDecide')

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'

export interface InstallationAgentLlmAccess {
  providerId: string
  model: string
  apiKey: string
}

function installationAgentModel(): string {
  const configured = env.INSTALLATION_AGENT_MODEL?.trim()
  if (configured) return configured
  return getProviderDefaultModel('openai')
}

function byokProviderId(providerId: string): BYOKProviderId {
  return (providerId === 'google' ? 'google' : providerId) as BYOKProviderId
}

function envPlatformKey(providerId: string): string | undefined {
  switch (providerId) {
    case 'openai':
      return env.OPENAI_API_KEY
    case 'anthropic':
      return env.ANTHROPIC_API_KEY_1
    case 'google':
      return env.GEMINI_API_KEY
    case 'mistral':
      return env.MISTRAL_API_KEY
    case 'xai':
      return env.XAI_API_KEY_1
    default:
      return undefined
  }
}

function rotatingPoolId(providerId: string): string {
  return providerId === 'google' ? 'gemini' : providerId
}

/**
 * Resolves provider credentials for the Installation pane agent (not mothership).
 * Returns null when no key is configured — caller keeps the heuristic decide.
 */
export async function resolveInstallationAgentLlmAccess(input: {
  workspaceId?: string | null
  abortSignal?: AbortSignal
}): Promise<InstallationAgentLlmAccess | null> {
  const model = installationAgentModel()
  const providerId = getProviderFromModel(model)

  if (input.workspaceId) {
    try {
      const byok = await getBYOKKey(input.workspaceId, byokProviderId(providerId), {
        signal: input.abortSignal,
      })
      if (byok?.apiKey) {
        return { providerId, model, apiKey: byok.apiKey }
      }
    } catch (error) {
      logger.warn('Installation agent BYOK lookup failed', {
        providerId,
        model,
        error: getErrorMessage(error),
      })
    }
  }

  const fromEnv = envPlatformKey(providerId)
  if (fromEnv) {
    return { providerId, model, apiKey: fromEnv }
  }

  if (isHosted) {
    try {
      return {
        providerId,
        model,
        apiKey: getRotatingApiKey(rotatingPoolId(providerId)),
      }
    } catch {
      return null
    }
  }

  return null
}

export function formatInstallationAgentProviderError(status: number, detail: string): string {
  const lower = detail.toLowerCase()
  if (status === 401 || lower.includes('unauthorized') || lower.includes('invalid api key')) {
    return (
      'Installation chat LLM: provider rejected the API key (check OPENAI_API_KEY, ' +
      'ANTHROPIC_API_KEY_1, GEMINI_API_KEY, or workspace BYOK). ' +
      `Detail: ${detail}`
    )
  }
  if (status === 403) {
    return `Installation chat LLM: provider refused the request (403). Detail: ${detail}`
  }
  return `Installation chat LLM: ${detail}`
}

function providerToolsFromCatalog(): ProviderToolConfig[] {
  return installationAgentToolDefinitions.map((def) => ({
    id: def.function.name,
    description: def.function.description,
    params: {},
    parameters: def.function.parameters as ProviderToolConfig['parameters'],
  }))
}

function loopMessagesToProviderMessages(
  messages: InstallationAgentLoopMessage[]
): { systemPrompt: string; thread: Message[] } {
  let systemPrompt = ''
  const thread: Message[] = []

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemPrompt = msg.content
      continue
    }
    if (msg.role === 'user') {
      thread.push({ role: 'user', content: msg.content })
      continue
    }
    if (msg.role === 'assistant') {
      thread.push({
        role: 'assistant',
        content: msg.content,
        tool_calls: msg.toolCalls?.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments ?? {}),
          },
        })),
      })
      continue
    }
    if (msg.role === 'tool') {
      thread.push({
        role: 'tool',
        content: msg.content,
        tool_call_id: msg.toolCallId,
        name: msg.name,
      })
    }
  }

  return { systemPrompt, thread }
}

function toolCallsFromWire(
  wireCalls: Array<{ id: string; name: string; arguments: string }>
): InstallationAgentToolCall[] {
  return wireCalls.map((call) => ({
    id: call.id || `call_${generateId()}`,
    name: call.name,
    arguments: parseToolArguments(call.arguments, call.name),
  }))
}

/**
 * One Responses API hop (tools declared, execution stays in the Installation loop).
 */
async function openAiResponsesDecideStep(input: {
  access: InstallationAgentLlmAccess
  systemPrompt: string
  messages: Message[]
  abortSignal?: AbortSignal
}): Promise<InstallationAgentDecideResult> {
  const catalogTools = providerToolsFromCatalog()
  const adapted = catalogTools.map(adaptOpenAIChatToolSchema)
  const prepared = prepareToolsWithUsageControl(adapted, catalogTools, logger, 'openai')
  const responseTools = convertToolsToResponses(prepared.tools ?? [])

  const allMessages: Message[] = []
  if (input.systemPrompt.trim()) {
    allMessages.push({ role: 'system', content: input.systemPrompt })
  }
  allMessages.push(...input.messages)

  const responseInput = buildResponsesInputFromMessages(allMessages, 'openai')
  if (responseInput.length === 0) {
    throw new Error('Installation chat LLM: empty message payload')
  }

  const body: Record<string, unknown> = {
    model: input.access.model,
    stream: false,
    input: responseInput,
    tools: responseTools,
    parallel_tool_calls: true,
    tool_choice: 'auto',
    temperature: 0.2,
  }

  // boundary-raw-fetch: single OpenAI Responses hop; tool execution stays in Installation loop
  const response = await fetchWithProviderRetry(
    () =>
      fetch(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.access.apiKey}`,
          'Content-Type': 'application/json',
          'OpenAI-Beta': 'responses=v1',
        },
        body: JSON.stringify(body),
        signal: input.abortSignal,
      }),
    {
      logger,
      label: 'InstallationAgentOpenAI',
      abortSignal: input.abortSignal,
    }
  )

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null)
    const detail =
      isRecordLike(payload) &&
      isRecordLike(payload.error) &&
      typeof payload.error.message === 'string'
        ? payload.error.message
        : `HTTP ${response.status}`
    throw new Error(formatInstallationAgentProviderError(response.status, detail))
  }

  const data: unknown = await response.json()
  if (!isRecordLike(data) || !Array.isArray(data.output)) {
    throw new Error('Installation chat LLM: unexpected provider response shape')
  }

  const toolCalls = extractResponseToolCalls(
    data.output as Parameters<typeof extractResponseToolCalls>[0]
  )
  const knownToolCalls = toolCalls.filter((call) => call.name === RUN_INSTALLATION_TOOL_NAME)

  if (knownToolCalls.length > 0) {
    return {
      type: 'tool_calls',
      toolCalls: toolCallsFromWire(knownToolCalls),
    }
  }

  const text = extractResponseText(
    data.output as Parameters<typeof extractResponseText>[0]
  ).trim()
  if (text) {
    return { type: 'assistant', content: text }
  }

  return {
    type: 'assistant',
    content: 'Не удалось получить ответ модели для Installation pane.',
  }
}

async function llmInstallationAgentDecide(
  access: InstallationAgentLlmAccess,
  input: {
    messages: InstallationAgentLoopMessage[]
    tools: typeof installationAgentToolDefinitions
  }
): Promise<InstallationAgentDecideResult> {
  void input.tools
  const { systemPrompt, thread } = loopMessagesToProviderMessages(input.messages)

  if (access.providerId !== 'openai') {
    throw new Error(
      `Installation chat LLM: model ${access.model} uses provider "${access.providerId}"; ` +
        'only OpenAI Responses is wired for pane decide (set INSTALLATION_AGENT_MODEL to an OpenAI id or set OPENAI_API_KEY).'
    )
  }

  return openAiResponsesDecideStep({
    access,
    systemPrompt,
    messages: thread,
  })
}

/**
 * Picks LLM decide when a provider key exists; otherwise the MVP heuristic.
 */
export async function createInstallationAgentDecide(input: {
  workspaceId?: string | null
  abortSignal?: AbortSignal
}): Promise<InstallationAgentDecide> {
  const access = await resolveInstallationAgentLlmAccess(input)
  if (!access) {
    logger.info('Installation agent using heuristic decide (no provider API key)')
    return defaultInstallationAgentDecide
  }

  logger.info('Installation agent using LLM decide', {
    providerId: access.providerId,
    model: access.model,
  })

  return async (decideInput) => {
    try {
      return await llmInstallationAgentDecide(access, decideInput)
    } catch (error) {
      const message = getErrorMessage(error)
      logger.error('Installation agent LLM decide failed', { error: message })
      throw toError(error instanceof Error ? error : new Error(message))
    }
  }
}
