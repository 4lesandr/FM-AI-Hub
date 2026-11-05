import type { Variable } from '@/stores/variables/types'

/**
 * Strip plaintext workflow variable values from a Publish snapshot (H1).
 * Keeps ids/names/types so the graph still references slots; values must not
 * leave the author's workspace (keys, tokens, prompts pasted into variables).
 */
export function redactAgentReleaseVariableValues(
  variables: Record<string, Variable> | null | undefined
): Record<string, Variable> {
  if (!variables) return {}

  const redacted: Record<string, Variable> = {}
  for (const [id, variable] of Object.entries(variables)) {
    if (!variable) continue
    redacted[id] = {
      ...variable,
      value: emptyValueForVariableType(variable.type),
      validationError: undefined,
    }
  }
  return redacted
}

function emptyValueForVariableType(type: Variable['type']): unknown {
  switch (type) {
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'object':
      return {}
    case 'array':
      return []
    case 'plain':
    case 'string':
    default:
      return ''
  }
}
