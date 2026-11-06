import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const executeMock = vi.fn()

vi.mock('@/lib/agent-installations/application/execute-agent-installation', () => ({
  executeAgentInstallation: {
    execute: (...args: unknown[]) => executeMock(...args),
  },
}))

import {
  dispatchInstallationAgentTool,
  installationAgentToolDefinitions,
  RUN_INSTALLATION_TOOL_NAME,
  stringifyInstallationAgentToolResult,
} from '@/lib/agent-installations/chat/tools'

describe('run_installation tool (C2)', () => {
  const principal = createSessionPrincipal({ userId: 'installer-1', sessionId: 'sess-1' })
  const installationId = 'inst-pane-1'

  beforeEach(() => {
    executeMock.mockReset()
  })

  it('agent loop → run_installation → executeAgentInstallation → result back in loop', async () => {
    executeMock.mockResolvedValue({
      installationId,
      releaseId: 'rel-1',
      workflowId: 'wf-1',
      version: 3,
      userId: 'installer-1',
      workspaceId: 'ws-installer',
      executionId: 'exec-9',
      status: 'completed',
      output: { reply: 'hello from pinned graph' },
      error: null,
    })

    // Minimal agent-loop step: model emitted a tool call; loop dispatches it.
    const toolResult = await dispatchInstallationAgentTool({
      context: { principal, installationId },
      name: RUN_INSTALLATION_TOOL_NAME,
      argumentsJson: JSON.stringify({ input: { input: 'run please' } }),
    })

    expect(executeMock).toHaveBeenCalledTimes(1)
    expect(executeMock).toHaveBeenCalledWith({
      principal,
      input: expect.objectContaining({
        installationId,
        input: { input: 'run please' },
      }),
    })

    expect(toolResult).toEqual({
      ok: true,
      tool: RUN_INSTALLATION_TOOL_NAME,
      installationId,
      releaseId: 'rel-1',
      workflowId: 'wf-1',
      version: 3,
      userId: 'installer-1',
      workspaceId: 'ws-installer',
      executionId: 'exec-9',
      status: 'completed',
      output: { reply: 'hello from pinned graph' },
      error: null,
    })

    // Next loop turn feeds this string back as tool message content.
    const loopPayload = stringifyInstallationAgentToolResult(toolResult)
    expect(JSON.parse(loopPayload).ok).toBe(true)
    expect(JSON.parse(loopPayload).output.reply).toBe('hello from pinned graph')
  })

  it('does not pass model-supplied installationId into execute (pane scope wins)', async () => {
    executeMock.mockResolvedValue({
      installationId,
      releaseId: 'rel-1',
      workflowId: 'wf-1',
      version: 1,
      userId: 'installer-1',
      workspaceId: 'ws-installer',
      executionId: 'exec-1',
      status: 'completed',
      output: 'ok',
      error: null,
    })

    await dispatchInstallationAgentTool({
      context: { principal, installationId },
      name: RUN_INSTALLATION_TOOL_NAME,
      arguments: {
        installationId: 'inst-attacker-other',
        input: { input: 'x' },
      },
    })

    expect(executeMock.mock.calls[0][0].input.installationId).toBe(installationId)
  })

  it('never puts author secrets / credentialBindings / release state into tool result', async () => {
    executeMock.mockResolvedValue({
      installationId,
      releaseId: 'rel-1',
      workflowId: 'wf-1',
      version: 1,
      userId: 'installer-1',
      workspaceId: 'ws-installer',
      executionId: 'exec-1',
      status: 'completed',
      output: { text: 'safe' },
      error: null,
      // If a future execute leak appeared, present must still strip these:
      credentialBindings: { 'block:apiKey': 'cred-author' },
      releaseState: { env: { AUTHOR_STRIPE_KEY: 'sk_live_author' } },
      authorUserId: 'author-99',
      createdBy: 'author-99',
    })

    const toolResult = await dispatchInstallationAgentTool({
      context: { principal, installationId },
      name: RUN_INSTALLATION_TOOL_NAME,
      arguments: { input: { input: 'hi' } },
    })

    const serialized = stringifyInstallationAgentToolResult(toolResult)
    expect(serialized).not.toContain('sk_live_author')
    expect(serialized).not.toContain('AUTHOR_STRIPE_KEY')
    expect(serialized).not.toContain('cred-author')
    expect(serialized).not.toContain('author-99')
    expect(serialized).not.toContain('credentialBindings')
    expect(serialized).not.toContain('releaseState')
    expect(toolResult.ok).toBe(true)
    if (toolResult.ok) {
      expect(toolResult.userId).toBe('installer-1')
    }
  })

  it('maps OrchestrationError from execute into a failed tool result for the loop', async () => {
    executeMock.mockRejectedValue(
      new OrchestrationError('not_found', 'Agent installation not found')
    )

    const toolResult = await dispatchInstallationAgentTool({
      context: { principal, installationId: 'missing' },
      name: RUN_INSTALLATION_TOOL_NAME,
      argumentsJson: '{}',
    })

    expect(toolResult).toEqual({
      ok: false,
      tool: RUN_INSTALLATION_TOOL_NAME,
      installationId: 'missing',
      code: 'not_found',
      error: 'Agent installation not found',
    })
  })

  it('exposes run_installation in the MVP tool catalog for the loop', () => {
    expect(installationAgentToolDefinitions.map((t) => t.function.name)).toEqual([
      RUN_INSTALLATION_TOOL_NAME,
    ])
  })
})
