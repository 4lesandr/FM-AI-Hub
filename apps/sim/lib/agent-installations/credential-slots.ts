import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks/registry'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

export interface AgentCredentialSlot {
  /** Stable install-binding key: `blockId:field`. */
  key: string
  blockId: string
  blockName: string
  field: string
  serviceId: string | null
  required: boolean
}

/**
 * Credential slots a sanitized AgentRelease still needs the installer to bind.
 * Walks oauth-input sub-blocks only — author credential ids were cleared on Publish.
 */
export function collectAgentCredentialSlots(
  state: Pick<Partial<WorkflowState>, 'blocks'> | null | undefined
): AgentCredentialSlot[] {
  const slots: AgentCredentialSlot[] = []

  for (const [blockId, block] of Object.entries(state?.blocks ?? {})) {
    if (!block?.type || block.enabled === false) continue
    const blockConfig = getBlock(block.type)
    if (!blockConfig) continue

    const subBlocks = block.subBlocks ?? {}
    const values: Record<string, unknown> = {}
    for (const [id, subBlock] of Object.entries(subBlocks)) values[id] = subBlock?.value

    const blockName =
      typeof block.name === 'string' && block.name.trim() ? block.name : blockConfig.name

    for (const config of blockConfig.subBlocks ?? []) {
      if (config.type !== 'oauth-input') continue
      if (!Object.hasOwn(subBlocks, config.id)) continue
      if (!evaluateSubBlockCondition(config.condition, values)) continue

      let required = false
      if (config.required === true) required = true
      else if (config.required) required = evaluateSubBlockCondition(config.required, values)

      slots.push({
        key: `${blockId}:${config.id}`,
        blockId,
        blockName,
        field: config.id,
        serviceId: config.serviceId ?? null,
        required,
      })
    }
  }

  return slots
}
