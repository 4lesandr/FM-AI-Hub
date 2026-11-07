/**
 * Install-by-link and Installation chat destinations.
 * Kept dependency-free so client and server agree on the path shape.
 */

/** Public share URL target: resolve token → «Поставить себе». */
export function installByTokenPath(token: string): string {
  return `/install/${encodeURIComponent(token)}`
}

function workspaceAppsBase(workspaceId: string): string {
  return `/workspace/${encodeURIComponent(workspaceId)}/apps`
}

/** Workspace Installations list (empty pane until one is opened). */
export function appsHomePath(workspaceId: string): string {
  return workspaceAppsBase(workspaceId)
}

/**
 * Workspace pane for one Installation (sidebar + chat).
 * Optional `title` is display-only for the chat header.
 */
export function appsInstallationPath(
  workspaceId: string,
  installationId: string,
  options?: { title?: string | null }
): string {
  const base = `${workspaceAppsBase(workspaceId)}/${encodeURIComponent(installationId)}`
  const title = options?.title?.trim()
  if (!title) return base
  return `${base}?title=${encodeURIComponent(title)}`
}

/**
 * Canonical post-Install / deep-link destination for Installation chat.
 */
export function installationChatPath(
  workspaceId: string,
  installationId: string,
  options?: { title?: string | null }
): string {
  return appsInstallationPath(workspaceId, installationId, options)
}

/**
 * Legacy top-level `/apps` URLs — kept for short redirects from old bookmarks.
 */
export function legacyAppsHomePath(): string {
  return '/apps'
}

export function legacyAppsInstallationPath(
  installationId: string,
  options?: { title?: string | null }
): string {
  const base = `/apps/${encodeURIComponent(installationId)}`
  const title = options?.title?.trim()
  if (!title) return base
  return `${base}?title=${encodeURIComponent(title)}`
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
