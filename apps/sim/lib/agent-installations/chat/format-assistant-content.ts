/**
 * Display text for assistant messages / SSE chunks.
 * Never includes credentialBindings or raw release state.
 */
export function formatInstallationAssistantContent(output: unknown): string {
  if (output === null || output === undefined) return ''
  if (typeof output === 'string') return output
  if (typeof output === 'object') {
    return `\`\`\`json\n${JSON.stringify(output, null, 2)}\n\`\`\``
  }
  return String(output)
}

/** Split text into small chunks so the pane can show a live stream. */
export function chunkTextForStream(text: string, chunkSize = 24): string[] {
  if (!text) return []
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize))
  }
  return chunks
}
