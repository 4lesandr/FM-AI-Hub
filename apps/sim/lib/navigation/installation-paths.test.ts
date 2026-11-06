import { describe, expect, test } from 'bun:test'
import {
  appsHomePath,
  appsInstallationPath,
  installationChatPath,
  installByTokenPath,
  legacyInstallationChatPath,
} from '@/lib/navigation/installation-paths'

describe('installation-paths (U3 agent-first routing)', () => {
  test('installByTokenPath encodes token', () => {
    expect(installByTokenPath('abc/def')).toBe('/install/abc%2Fdef')
  })

  test('apps home and installation pane', () => {
    expect(appsHomePath()).toBe('/apps')
    expect(appsInstallationPath('inst-1')).toBe('/apps/inst-1')
    expect(appsInstallationPath('inst-1', { title: 'Test Chat Agent' })).toBe(
      '/apps/inst-1?title=Test%20Chat%20Agent'
    )
  })

  test('installationChatPath is agent home, not LogoShell or workspace console', () => {
    const path = installationChatPath('inst-9', { title: 'Agent' })
    expect(path).toBe('/apps/inst-9?title=Agent')
    expect(path.startsWith('/apps/')).toBe(true)
    expect(path.includes('/workspace/')).toBe(false)
    expect(path.includes('/w/')).toBe(false)
    expect(path).toBe(appsInstallationPath('inst-9', { title: 'Agent' }))
  })

  test('legacyInstallationChatPath keeps pre-U3 shape for redirects', () => {
    expect(legacyInstallationChatPath('inst-9')).toBe('/installations/inst-9/chat')
    expect(legacyInstallationChatPath('inst-9', { title: 'Agent' })).toBe(
      '/installations/inst-9/chat?title=Agent'
    )
  })
})
