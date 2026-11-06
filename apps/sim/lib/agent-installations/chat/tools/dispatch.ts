import { createLogger } from '@sim/logger'
import {
  executeRunInstallationTool,
  RUN_INSTALLATION_TOOL_NAME,
  type RunInstallationToolArgs,
  type RunInstallationToolContext,
  type RunInstallationToolResult,
  runInstallationToolDefinition,
} from '@/lib/agent-installations/chat/tools/run-installation'

const logger = createLogger('InstallationChat.ToolDispatch')

/** MVP tool catalog for the Installation agent loop (C2: T1). */
export const installationAgentToolDefinitions = [runInstallationToolDefinition] as const

export type InstallationAgentToolName = typeof RUN_INSTALLATION_TOOL_NAME

export interface DispatchInstallationAgentToolInput {
  context: RunInstallationToolContext
  name: string
  /** Raw JSON args from the model tool call. */
  argumentsJson?: string | null
  /** Already-parsed args (preferred in tests / in-process loop). */
  arguments?: Record<string, unknown> | null
}

function parseToolArguments(
  argumentsJson: string | null | undefined,
  argumentsObject: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (argumentsObject && typeof argumentsObject === 'object') {
    return argumentsObject
  }
  const raw = argumentsJson?.trim()
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return {}
  } catch {
    throw new Error('Tool arguments must be a JSON object')
  }
}

function toRunInstallationArgs(raw: Record<string, unknown>): RunInstallationToolArgs {
  const args: RunInstallationToolArgs = {}
  if ('input' in raw) {
    args.input = raw.input
  }
  if (typeof raw.triggerBlockId === 'string' && raw.triggerBlockId.trim()) {
    args.triggerBlockId = raw.triggerBlockId.trim()
  }
  // Defense: model must not override pane scope via args.
  if ('installationId' in raw) {
    logger.warn('Ignoring model-supplied installationId on run_installation')
  }
  return args
}

/**
 * Agent-loop entry: name + args → tool → JSON-serializable result for the next
 * model turn. Secrets of the Release author never enter this payload.
 */
export async function dispatchInstallationAgentTool(
  input: DispatchInstallationAgentToolInput
): Promise<RunInstallationToolResult> {
  const name = input.name.trim()
  let rawArgs: Record<string, unknown>
  try {
    rawArgs = parseToolArguments(input.argumentsJson, input.arguments)
  } catch (error) {
    return {
      ok: false,
      tool: RUN_INSTALLATION_TOOL_NAME,
      installationId: input.context.installationId,
      code: 'validation',
      error: error instanceof Error ? error.message : 'Invalid tool arguments',
    }
  }

  if (name === RUN_INSTALLATION_TOOL_NAME) {
    return executeRunInstallationTool(input.context, toRunInstallationArgs(rawArgs))
  }

  logger.warn('Unknown installation agent tool', { name })
  return {
    ok: false,
    tool: RUN_INSTALLATION_TOOL_NAME,
    installationId: input.context.installationId,
    code: 'validation',
    error: `Unknown tool: ${name}`,
  }
}

/** Stringify tool result for chat-completions `tool` role content. */
export function stringifyInstallationAgentToolResult(result: RunInstallationToolResult): string {
  return JSON.stringify(result)
}
