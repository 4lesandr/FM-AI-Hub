import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  hardenAgentReleaseSnapshot,
  OPAQUE_ENV_REF,
  resolveAgentReleasePromptTier,
} from '@/lib/agent-installations/harden-release-snapshot'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

vi.mock('@/blocks/registry', () => ({
  getBlock: vi.fn(() => ({
    name: 'Agent',
    description: '',
    subBlocks: [
      { id: 'messages', type: 'messages-input' },
      { id: 'systemPrompt', type: 'long-input' },
      { id: 'apiKey', type: 'short-input', password: true },
      { id: 'token', type: 'short-input' },
      { id: 'note', type: 'short-input' },
    ],
    outputs: {},
  })),
}))

function blockState(subBlocks: Record<string, { id: string; type: string; value: unknown }>) {
  return {
    blocks: {
      agent1: {
        id: 'agent1',
        type: 'agent',
        name: 'Agent',
        position: { x: 0, y: 0 },
        subBlocks,
        outputs: {},
        enabled: true,
      },
    },
  } as unknown as Partial<WorkflowState>
}

describe('resolveAgentReleasePromptTier', () => {
  const original = process.env.AGENT_RELEASE_STRIP_SYSTEM_PROMPTS

  beforeEach(() => {
    if (original === undefined) delete process.env.AGENT_RELEASE_STRIP_SYSTEM_PROMPTS
    else process.env.AGENT_RELEASE_STRIP_SYSTEM_PROMPTS = original
  })

  it('defaults to retain', () => {
    delete process.env.AGENT_RELEASE_STRIP_SYSTEM_PROMPTS
    expect(resolveAgentReleasePromptTier()).toBe('retain')
  })

  it('honours explicit retain over env strip', () => {
    process.env.AGENT_RELEASE_STRIP_SYSTEM_PROMPTS = 'true'
    expect(resolveAgentReleasePromptTier('retain')).toBe('retain')
  })

  it('forces strip-system from env when omitted', () => {
    process.env.AGENT_RELEASE_STRIP_SYSTEM_PROMPTS = 'true'
    expect(resolveAgentReleasePromptTier()).toBe('strip-system')
  })
})

describe('hardenAgentReleaseSnapshot', () => {
  it('H5: replaces author ENV names with opaque {{env}}', () => {
    const hardened = hardenAgentReleaseSnapshot(
      blockState({
        note: {
          id: 'note',
          type: 'short-input',
          value: 'Call {{STRIPE_LIVE_KEY}} then {{INTERNAL_API}}',
        },
      })
    )
    expect(hardened.blocks?.agent1.subBlocks.note.value).toBe(
      `Call ${OPAQUE_ENV_REF} then ${OPAQUE_ENV_REF}`
    )
    expect(JSON.stringify(hardened)).not.toContain('STRIPE_LIVE_KEY')
    expect(JSON.stringify(hardened)).not.toContain('INTERNAL_API')
  })

  it('H2: redacts secret-like short-input without password:true', () => {
    const hardened = hardenAgentReleaseSnapshot(
      blockState({
        token: { id: 'token', type: 'short-input', value: 'sk-live-abcdefghijklmnopqrstuv' },
        note: { id: 'note', type: 'short-input', value: 'hello world' },
      })
    )
    expect(hardened.blocks?.agent1.subBlocks.token.value).toBeNull()
    expect(hardened.blocks?.agent1.subBlocks.note.value).toBe('hello world')
  })

  it('H2: redacts high-entropy pasted tokens on non-password short-input', () => {
    const hardened = hardenAgentReleaseSnapshot(
      blockState({
        note: {
          id: 'note',
          type: 'short-input',
          value: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
        },
      })
    )
    expect(hardened.blocks?.agent1.subBlocks.note.value).toBeNull()
  })

  it('H2: keeps UUIDs and simple slugs', () => {
    const hardened = hardenAgentReleaseSnapshot(
      blockState({
        note: {
          id: 'note',
          type: 'short-input',
          value: 'a1b2c3d4-e5f6-4789-a012-3456789abcde',
        },
      })
    )
    expect(hardened.blocks?.agent1.subBlocks.note.value).toBe(
      'a1b2c3d4-e5f6-4789-a012-3456789abcde'
    )
  })

  it('C2: strip-system clears system messages and systemPrompt', () => {
    const hardened = hardenAgentReleaseSnapshot(
      blockState({
        systemPrompt: {
          id: 'systemPrompt',
          type: 'long-input',
          value: 'You are the secret FLOMNI agent',
        },
        messages: {
          id: 'messages',
          type: 'messages-input',
          value: [
            { role: 'system', content: 'Commercial IP prompt' },
            { role: 'user', content: '<start.input>' },
          ],
        },
      }),
      { promptTier: 'strip-system' }
    )
    expect(hardened.blocks?.agent1.subBlocks.systemPrompt.value).toBe('')
    expect(hardened.blocks?.agent1.subBlocks.messages.value).toEqual([
      { role: 'system', content: '' },
      { role: 'user', content: '<start.input>' },
    ])
  })

  it('C2: retain keeps system prompts', () => {
    const hardened = hardenAgentReleaseSnapshot(
      blockState({
        systemPrompt: {
          id: 'systemPrompt',
          type: 'long-input',
          value: 'You are helpful',
        },
      }),
      { promptTier: 'retain' }
    )
    expect(hardened.blocks?.agent1.subBlocks.systemPrompt.value).toBe('You are helpful')
  })
})
