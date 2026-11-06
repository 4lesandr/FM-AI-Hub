import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const executeMock = vi.fn()

vi.mock('@/lib/agent-installations/application/execute-agent-installation', () => ({
  executeAgentInstallation: {
    execute: (...args: unknown[]) => executeMock(...args),
  },
}))

import {
  defaultInstallationAgentDecide,
  INSTALLATION_AGENT_SYSTEM_PROMPT,
  runInstallationAgentLoop,
  type InstallationAgentDecide,
} from '@/lib/agent-installations/chat/agent-loop'
import { runInstallationPaneTurn } from '@/lib/agent-installations/chat/pane-turn-runner'
import { RUN_INSTALLATION_TOOL_NAME } from '@/lib/agent-installations/chat/tools'

describe('Installation agent loop (C1)', () => {
  const principal = createSessionPrincipal({ userId: 'installer-1', sessionId: 'sess-1' })
  const installationId = 'inst-pane-1'

  beforeEach(() => {
    executeMock.mockReset()
  })

  it('loop → decide tool_calls → dispatchInstallationAgentTool / run_installation (not one-shot UI)', async () => {
    executeMock.mockResolvedValue({
      installationId,
      releaseId: 'rel-1',
      workflowId: 'wf-1',
      version: 3,
      userId: 'installer-1',
      workspaceId: 'ws-installer',
      executionId: 'exec-9',
      status: 'completed',
      output: { reply: 'from loop tool' },
      error: null,
    })

    const decide: InstallationAgentDecide = vi
      .fn()
      .mockResolvedValueOnce({
        type: 'tool_calls',
        toolCalls: [
          {
            id: 'call_test_1',
            name: RUN_INSTALLATION_TOOL_NAME,
            arguments: { input: { input: 'run via loop' } },
          },
        ],
      })
      .mockResolvedValueOnce({
        type: 'assistant',
        content: 'Готово через agent loop.',
      })

    const toolEvents: Array<{ phase: string; name: string }> = []

    const result = await runInstallationAgentLoop({
      context: { principal, installationId, requestId: 'req-1' },
      message: 'run via loop',
      decide,
      onToolEvent: (e) => toolEvents.push({ phase: e.phase, name: e.name }),
    })

    expect(decide).toHaveBeenCalled()
    const firstDecideArg = (decide as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(firstDecideArg.messages[0]).toEqual({
      role: 'system',
      content: INSTALLATION_AGENT_SYSTEM_PROMPT,
    })
    expect(firstDecideArg.messages[1]).toEqual({ role: 'user', content: 'run via loop' })
    expect(firstDecideArg.tools.map((t: { function: { name: string } }) => t.function.name)).toEqual([
      RUN_INSTALLATION_TOOL_NAME,
    ])

    expect(executeMock).toHaveBeenCalledTimes(1)
    expect(executeMock).toHaveBeenCalledWith({
      principal,
      input: expect.objectContaining({
        installationId,
        input: { input: 'run via loop' },
      }),
    })

    expect(toolEvents).toEqual([
      { phase: 'start', name: RUN_INSTALLATION_TOOL_NAME },
      { phase: 'end', name: RUN_INSTALLATION_TOOL_NAME },
    ])
    expect(result.assistantContent).toBe('Готово через agent loop.')
    expect(result.success).toBe(true)
    expect(result.toolResults).toHaveLength(1)
    expect(result.toolResults[0].ok).toBe(true)
  })

  it('can answer without run_installation (meta / no tool)', async () => {
    const result = await runInstallationAgentLoop({
      context: { principal, installationId },
      message: 'что ты умеешь',
      decide: defaultInstallationAgentDecide,
    })

    expect(executeMock).not.toHaveBeenCalled()
    expect(result.success).toBe(true)
    expect(result.assistantContent).toContain(RUN_INSTALLATION_TOOL_NAME)
    expect(result.toolResults).toHaveLength(0)
  })

  it('runInstallationPaneTurn wires loop (not pre-C1 one-shot-only body)', async () => {
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

    const decide: InstallationAgentDecide = vi
      .fn()
      .mockResolvedValueOnce({
        type: 'tool_calls',
        toolCalls: [
          {
            id: 'call_pane',
            name: RUN_INSTALLATION_TOOL_NAME,
            arguments: { input: { input: 'pane msg' } },
          },
        ],
      })
      .mockResolvedValueOnce({ type: 'assistant', content: 'pane loop done' })

    const turn = await runInstallationPaneTurn({
      principal,
      installationId,
      message: 'pane msg',
      requestId: 'req-pane',
      decide,
    })

    expect(decide).toHaveBeenCalled()
    expect(executeMock).toHaveBeenCalledTimes(1)
    expect(turn).toEqual({ assistantContent: 'pane loop done', success: true })
  })

  it('default decide emits run_installation tool call for normal user text', async () => {
    const decision = await defaultInstallationAgentDecide({
      messages: [
        { role: 'system', content: INSTALLATION_AGENT_SYSTEM_PROMPT },
        { role: 'user', content: 'Сделай отчёт по продажам' },
      ],
      tools: [{ type: 'function', function: { name: RUN_INSTALLATION_TOOL_NAME } }] as never,
    })

    expect(decision.type).toBe('tool_calls')
    if (decision.type === 'tool_calls') {
      expect(decision.toolCalls[0].name).toBe(RUN_INSTALLATION_TOOL_NAME)
      expect(decision.toolCalls[0].arguments).toEqual({
        input: { input: 'Сделай отчёт по продажам' },
      })
    }
  })
})
