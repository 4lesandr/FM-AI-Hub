import type { SessionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import {
  executeAgentInstallation,
  type ExecuteAgentInstallationResult,
} from '@/lib/agent-installations/application/execute-agent-installation'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const logger = createLogger('InstallationChat.RunInstallation')

/** OpenAI-compat / provider tool name — T1 in /3g-chat spec. */
export const RUN_INSTALLATION_TOOL_NAME = 'run_installation' as const

/**
 * LLM-facing schema for `run_installation`.
 * `installationId` is NOT a parameter: the pane/session scopes it so the model
 * cannot target another Installation.
 */
export const runInstallationToolDefinition = {
  type: 'function' as const,
  function: {
    name: RUN_INSTALLATION_TOOL_NAME,
    description:
      'Run the pinned published workflow for this Installation under the installer identity ' +
      '(same path as POST /api/agent-installations/{id}/execute). Use when the user asks to ' +
      'execute the app / agent capability. Does not expose author secrets.',
    parameters: {
      type: 'object',
      properties: {
        input: {
          description:
            'Trigger input for the pinned release (same shape as execute body.input). ' +
            'Often `{ input: "<user text>" }` for a single text trigger.',
        },
        triggerBlockId: {
          type: 'string',
          description:
            'Optional trigger block id when the pinned release has multiple runnable triggers.',
        },
      },
      additionalProperties: false,
    },
  },
}

export interface RunInstallationToolArgs {
  input?: unknown
  triggerBlockId?: string
}

export interface RunInstallationToolContext {
  principal: SessionPrincipal
  /** Pane-scoped Installation — never taken from model args. */
  installationId: string
  requestId?: string
  abortSignal?: AbortSignal
  requestHeaders?: Headers
}

/**
 * Safe tool payload for the agent loop. Mirrors execute route `present`,
 * without credentialBindings / release state / author identity fields.
 */
export interface RunInstallationToolSuccess {
  ok: true
  tool: typeof RUN_INSTALLATION_TOOL_NAME
  installationId: string
  releaseId: string
  workflowId: string
  version: number
  /** Installer (Installation.userId) — never AgentRelease.createdBy. */
  userId: string
  workspaceId: string
  executionId: string
  status: ExecuteAgentInstallationResult['status']
  output: ExecuteAgentInstallationResult['output']
  error: ExecuteAgentInstallationResult['error']
}

export interface RunInstallationToolFailure {
  ok: false
  tool: typeof RUN_INSTALLATION_TOOL_NAME
  installationId: string
  code: string
  error: string
}

export type RunInstallationToolResult = RunInstallationToolSuccess | RunInstallationToolFailure

function presentSuccess(
  result: ExecuteAgentInstallationResult
): RunInstallationToolSuccess {
  return {
    ok: true,
    tool: RUN_INSTALLATION_TOOL_NAME,
    installationId: result.installationId,
    releaseId: result.releaseId,
    workflowId: result.workflowId,
    version: result.version,
    userId: result.userId,
    workspaceId: result.workspaceId,
    executionId: result.executionId,
    status: result.status,
    output: result.output,
    error: result.error,
  }
}

/**
 * T1: thin wrapper over `executeAgentInstallation` (same graph/identity as
 * POST …/execute). Author Release secrets stay out of the tool result.
 */
export async function executeRunInstallationTool(
  context: RunInstallationToolContext,
  args: RunInstallationToolArgs = {}
): Promise<RunInstallationToolResult> {
  const installationId = context.installationId.trim()
  if (!installationId) {
    return {
      ok: false,
      tool: RUN_INSTALLATION_TOOL_NAME,
      installationId: '',
      code: 'validation',
      error: 'Installation id is required',
    }
  }

  try {
    const result = await executeAgentInstallation.execute({
      principal: context.principal,
      input: {
        installationId,
        input: args.input,
        triggerBlockId: args.triggerBlockId,
        requestId: context.requestId,
        abortSignal: context.abortSignal,
        requestHeaders: context.requestHeaders,
      },
    })

    logger.info('run_installation tool completed via executeAgentInstallation', {
      installationId: result.installationId,
      releaseId: result.releaseId,
      executionId: result.executionId,
      status: result.status,
      installerUserId: result.userId,
    })

    return presentSuccess(result)
  } catch (error) {
    if (error instanceof OrchestrationError) {
      logger.warn('run_installation tool refused', {
        installationId,
        code: error.code,
        message: error.message,
      })
      return {
        ok: false,
        tool: RUN_INSTALLATION_TOOL_NAME,
        installationId,
        code: error.code,
        error: error.message,
      }
    }

    logger.error('run_installation tool failed', {
      installationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      ok: false,
      tool: RUN_INSTALLATION_TOOL_NAME,
      installationId,
      code: 'internal',
      error: 'Installation execute failed',
    }
  }
}
