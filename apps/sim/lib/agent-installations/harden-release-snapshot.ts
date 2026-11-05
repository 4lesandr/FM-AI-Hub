import { getBlock } from '@/blocks/registry'
import { ENV_REF_PATTERN } from '@/lib/workflows/references/remap-references'
import type { SubBlockState, WorkflowState } from '@/stores/workflows/workflow/types'

/**
 * C2 prompt policy for AgentRelease snapshots.
 *
 * - `retain` (default): system/user prompts stay in the release so Install-by-link
 *   agents run. Publish is an intentional IP share; access control is org-bound
 *   share (C1) + revoke (H4). Documented in docs/deploy/mvp-install-slice.md.
 * - `strip-system`: clear system-role message content and `systemPrompt` fields.
 *   Use for scaffolding-only shares that must not ship commercial prompts.
 *
 * Org-wide override: `AGENT_RELEASE_STRIP_SYSTEM_PROMPTS=true` forces `strip-system`
 * unless the caller explicitly passes `retain`.
 */
export type AgentReleasePromptTier = 'retain' | 'strip-system'

export interface HardenAgentReleaseSnapshotOptions {
  promptTier?: AgentReleasePromptTier
}

/** Opaque placeholder — keeps `{{…}}` shape for executors without leaking author env names (H5). */
export const OPAQUE_ENV_REF = '{{env}}'

const SECRET_LIKE_FIELD = /(?:api[_-]?key|access[_-]?token|auth(?:orization|[_-]?token)?|bearer|password|secret|private[_-]?key|client[_-]?secret)/i

const SECRET_LIKE_VALUE =
  /^(?:sk-(?:live|test|proj|ant)-|[sk]k_[a-z]+_|ghp_|gho_|github_pat_|xox[baprs]-|AKIA[0-9A-Z]{16}|Bearer\s+\S+|-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----)/i

/** High-entropy token-ish strings (no whitespace), length ≥ 32, mixed class. */
const HIGH_ENTROPY_TOKEN = /^[A-Za-z0-9_\-./+=]{32,}$/
const UUID_LIKE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SIMPLE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const TEXT_SUBBLOCK_TYPES = new Set(['short-input', 'long-input', 'code', 'input'])

export function resolveAgentReleasePromptTier(
  requested?: AgentReleasePromptTier
): AgentReleasePromptTier {
  if (requested === 'retain' || requested === 'strip-system') return requested
  if (process.env.AGENT_RELEASE_STRIP_SYSTEM_PROMPTS === 'true') return 'strip-system'
  return 'retain'
}

/**
 * Publish-only hardening after export sanitization + H1 variable redact.
 * Does not change general workflow export (FVKS / ZIP / APIs untouched).
 *
 * - C2: optional strip of system prompts (`promptTier`)
 * - H2: redact secret-like plaintext in non-password text fields
 * - H5: replace `{{ENV_NAME}}` with opaque `{{env}}` so author env names never reach installers
 */
export function hardenAgentReleaseSnapshot(
  state: Partial<WorkflowState> | null | undefined,
  options: HardenAgentReleaseSnapshotOptions = {}
): Partial<WorkflowState> {
  const next = structuredClone(state ?? {}) as Partial<WorkflowState>
  if (!next.blocks) return next

  const promptTier = resolveAgentReleasePromptTier(options.promptTier)

  for (const block of Object.values(next.blocks)) {
    if (!block?.subBlocks) continue
    const blockConfig = block.type ? getBlock(block.type) : null
    const passwordIds = new Set(
      (blockConfig?.subBlocks ?? []).filter((sub) => sub.password === true).map((sub) => sub.id)
    )

    for (const [key, subBlock] of Object.entries(block.subBlocks)) {
      if (!subBlock) continue
      let value = subBlock.value

      value = opaqueEnvNamesInValue(value)

      if (promptTier === 'strip-system') {
        value = stripSystemPromptsInSubBlock(key, subBlock, value)
      }

      if (!passwordIds.has(key) && TEXT_SUBBLOCK_TYPES.has(subBlock.type)) {
        value = redactSecretLikePlaintext(key, value)
      }

      subBlock.value = value
    }
  }

  return next
}

function opaqueEnvNamesInValue(value: unknown): unknown {
  if (typeof value === 'string') return opaqueEnvNamesInText(value)
  if (Array.isArray(value)) return value.map(opaqueEnvNamesInValue)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = opaqueEnvNamesInValue(v)
    }
    return out
  }
  return value
}

function opaqueEnvNamesInText(text: string): string {
  ENV_REF_PATTERN.lastIndex = 0
  return text.replace(ENV_REF_PATTERN, OPAQUE_ENV_REF)
}

function stripSystemPromptsInSubBlock(
  key: string,
  subBlock: SubBlockState,
  value: unknown
): unknown {
  if (key === 'systemPrompt' || subBlock.id === 'systemPrompt') {
    return typeof value === 'string' ? '' : null
  }

  if (subBlock.type === 'messages-input') {
    return stripSystemRoleMessages(value)
  }

  return value
}

function stripSystemRoleMessages(value: unknown): unknown {
  const messages = parseMessages(value)
  if (!messages) return value

  const stripped = messages.map((message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return message
    const role = (message as { role?: unknown }).role
    if (role !== 'system') return message
    return { ...message, content: '' }
  })

  return typeof value === 'string' ? JSON.stringify(stripped) : stripped
}

function parseMessages(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed.startsWith('[')) return null
    try {
      const parsed = JSON.parse(trimmed) as unknown
      return Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  return null
}

function redactSecretLikePlaintext(fieldKey: string, value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return value

  if (SECRET_LIKE_FIELD.test(fieldKey) && !isOpaqueOrEmptyEnvRef(trimmed)) {
    return null
  }

  if (SECRET_LIKE_VALUE.test(trimmed)) return null

  // Plain short-input pasted tokens: long, no spaces, not a template/reference/UUID/slug.
  if (
    !trimmed.includes(' ') &&
    !trimmed.includes('<') &&
    !trimmed.includes('{{') &&
    !UUID_LIKE.test(trimmed) &&
    !SIMPLE_SLUG.test(trimmed) &&
    HIGH_ENTROPY_TOKEN.test(trimmed) &&
    /[A-Z]/.test(trimmed) &&
    /[a-z]/.test(trimmed) &&
    /\d/.test(trimmed)
  ) {
    return null
  }

  return value
}

function isOpaqueOrEmptyEnvRef(value: string): boolean {
  ENV_REF_PATTERN.lastIndex = 0
  const match = ENV_REF_PATTERN.exec(value)
  return Boolean(match && match[0] === value)
}
