import { describe, expect, test } from 'vitest'
import {
  appsHomePath,
  appsInstallationPath,
  installationChatPath,
  legacyAppsHomePath,
  legacyAppsInstallationPath,
} from '@/lib/navigation/installation-paths'

describe('installation paths', () => {
  const workspaceId = 'ws-1'

  test('apps home under workspace chrome', () => {
    expect(appsHomePath(workspaceId)).toBe('/workspace/ws-1/apps')
    expect(legacyAppsHomePath()).toBe('/apps')
  })

  test('apps installation pane encodes id and optional title', () => {
    expect(appsInstallationPath(workspaceId, 'inst-1')).toBe('/workspace/ws-1/apps/inst-1')
    expect(appsInstallationPath(workspaceId, 'inst-1', { title: 'Test Chat Agent' })).toBe(
      '/workspace/ws-1/apps/inst-1?title=Test%20Chat%20Agent'
    )
    expect(legacyAppsInstallationPath('inst-1')).toBe('/apps/inst-1')
  })

  test('installationChatPath is workspace Installation pane', () => {
    const path = installationChatPath(workspaceId, 'inst-9', { title: 'Agent' })
    expect(path).toBe('/workspace/ws-1/apps/inst-9?title=Agent')
    expect(path).toBe(appsInstallationPath(workspaceId, 'inst-9', { title: 'Agent' }))
  })
})
