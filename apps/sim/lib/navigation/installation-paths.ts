/**
 * Install-by-link and Installation chat destinations.
 * Kept dependency-free so client and server agree on the path shape.
 */

/** Public share URL target: resolve token → «Поставить себе». */
export function installByTokenPath(token: string): string {
  return `/install/${encodeURIComponent(token)}`
}

/**
 * Full-screen chat for an Installation (installer identity execute path).
 * Optional `title` is display-only for the chat header.
 */
export function installationChatPath(
  installationId: string,
  options?: { title?: string | null }
): string {
  const base = `/installations/${encodeURIComponent(installationId)}/chat`
  const title = options?.title?.trim()
  if (!title) return base
  return `${base}?title=${encodeURIComponent(title)}`
}
