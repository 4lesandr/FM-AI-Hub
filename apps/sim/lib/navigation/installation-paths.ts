/**
 * Install-by-link and Installation chat destinations.
 * Kept dependency-free so client and server agree on the path shape.
 */

/** Public share URL target: resolve token → «Поставить себе». */
export function installByTokenPath(token: string): string {
  return `/install/${encodeURIComponent(token)}`
}

/** Agent-home rail: list of Installations (U2). */
export function appsHomePath(): string {
  return '/apps'
}

/**
 * Agent-home pane for one Installation (shell + chat).
 * Optional `title` is display-only for the chat header.
 */
export function appsInstallationPath(
  installationId: string,
  options?: { title?: string | null }
): string {
  const base = `/apps/${encodeURIComponent(installationId)}`
  const title = options?.title?.trim()
  if (!title) return base
  return `${base}?title=${encodeURIComponent(title)}`
}

/**
 * Canonical post-Install / deep-link destination for Installation chat.
 * Points at agent home (`/apps/{id}`), not LogoShell and not Publisher `/w/...`.
 */
export function installationChatPath(
  installationId: string,
  options?: { title?: string | null }
): string {
  return appsInstallationPath(installationId, options)
}

/**
 * Pre-U3 URL shape. Kept for deep-link redirect from `/installations/.../chat`.
 * Do not navigate here from new UI — use {@link installationChatPath}.
 */
export function legacyInstallationChatPath(
  installationId: string,
  options?: { title?: string | null }
): string {
  const base = `/installations/${encodeURIComponent(installationId)}/chat`
  const title = options?.title?.trim()
  if (!title) return base
  return `${base}?title=${encodeURIComponent(title)}`
}
