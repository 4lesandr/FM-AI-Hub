export const AGENT_INSTALLATION_UPDATES_STALE_TIME = 30 * 1000
export const AGENT_RELEASE_BY_TOKEN_STALE_TIME = 30 * 1000

export const agentInstallationKeys = {
  all: ['agentInstallations'] as const,
  updates: () => [...agentInstallationKeys.all, 'updates'] as const,
  releases: () => [...agentInstallationKeys.all, 'releases'] as const,
  byToken: (token: string) => [...agentInstallationKeys.releases(), 'byToken', token] as const,
}
