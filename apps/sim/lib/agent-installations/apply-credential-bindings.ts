import type { NormalizedWorkflowData } from '@sim/workflow-persistence/types'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/**
 * Writes installer credential ids into a sanitized AgentRelease snapshot.
 * Slot keys are `blockId:field` (see collectAgentCredentialSlots). Author
 * secrets were cleared on Publish; only Installation.credentialBindings apply.
 */
export function applyAgentInstallationCredentialBindings(
  state: Partial<WorkflowState> | null | undefined,
  bindings: Record<string, string>
): WorkflowState {
  const next = structuredClone(state ?? {}) as WorkflowState
  if (!next.blocks) next.blocks = {}

  for (const [key, credentialId] of Object.entries(bindings)) {
    if (!credentialId?.trim()) continue
    const sep = key.indexOf(':')
    if (sep <= 0) continue
    const blockId = key.slice(0, sep)
    const field = key.slice(sep + 1)
    if (!field) continue

    const block = next.blocks[blockId]
    if (!block) continue
    if (!block.subBlocks) block.subBlocks = {}
    const existing = block.subBlocks[field]
    block.subBlocks[field] = {
      id: existing?.id ?? field,
      type: existing?.type ?? 'oauth-input',
      value: credentialId.trim(),
    }
  }

  return next
}

/** Release/export state → draft snapshot for executeWorkflowService(useDraftState). */
export function agentReleaseStateToDraft(
  state: Partial<WorkflowState> | null | undefined
): NormalizedWorkflowData {
  return {
    blocks: (state?.blocks ?? {}) as NormalizedWorkflowData['blocks'],
    edges: (state?.edges ?? []) as NormalizedWorkflowData['edges'],
    loops: (state?.loops ?? {}) as NormalizedWorkflowData['loops'],
    parallels: (state?.parallels ?? {}) as NormalizedWorkflowData['parallels'],
    isFromNormalizedTables: false,
  }
}
