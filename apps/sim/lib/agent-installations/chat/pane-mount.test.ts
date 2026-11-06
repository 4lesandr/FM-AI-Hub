import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  appsInstallationPath,
  installationChatPath,
} from '@/lib/navigation/installation-paths'

const simRoot = join(import.meta.dir, '../../../')

describe('C4 pane mount /apps/{id}', () => {
  test('canonical chat path is agent-home pane, not LogoShell legacy', () => {
    expect(installationChatPath('inst-1')).toBe('/apps/inst-1')
    expect(appsInstallationPath('inst-1')).toBe('/apps/inst-1')
  })

  test('/apps/[installationId] mounts InstallationChat without LogoShell', () => {
    const page = readFileSync(
      join(simRoot, 'app/apps/[installationId]/page.tsx'),
      'utf8'
    )
    expect(page).toContain('InstallationChat')
    expect(page).toContain('installationId={installationId}')
    expect(page).not.toContain('LogoShell')
    expect(page).not.toContain('InterfacesShell')
    expect(page).not.toContain('embedded')
  })

  test('apps layout is WorkspaceChrome rail, not LogoShell', () => {
    const layout = readFileSync(join(simRoot, 'app/apps/layout.tsx'), 'utf8')
    expect(layout).toContain('AgentAppsSidebar')
    expect(layout).toContain('WorkspaceChrome')
    expect(layout).not.toContain('LogoShell')
  })

  test('InstallationChat has no LogoShell / InterfacesShell fallback', () => {
    const chat = readFileSync(
      join(simRoot, 'app/installations/[installationId]/chat/installation-chat.tsx'),
      'utf8'
    )
    expect(chat).toContain('ChatPane')
    expect(chat).toContain('/api/agent-installations/${installationId}/chat')
    expect(chat).not.toMatch(/from ['"]@\/app\/\(landing\)\/components\/logo-shell['"]/)
    expect(chat).not.toMatch(/from ['"]@\/app\/\(interfaces\)\/components['"]/)
    expect(chat).not.toContain('InterfacesShell')
    expect(chat).not.toContain('ChatViewport')
    expect(chat).not.toContain('embedded')
  })

  test('C1 seam: stream turn delegates body to pane-turn-runner (loop lives there)', () => {
    const stream = readFileSync(
      join(simRoot, 'lib/agent-installations/chat/stream-chat-turn.ts'),
      'utf8'
    )
    expect(stream).toContain('runInstallationPaneTurn')
    // Stream owns SSE; tool dispatch stays inside agent loop / pane-turn-runner.
    expect(stream).not.toContain('dispatchInstallationAgentTool')
  })

  test('C1 pane-turn-runner uses agent loop, not one-shot-only dispatch body', () => {
    const runner = readFileSync(
      join(simRoot, 'lib/agent-installations/chat/pane-turn-runner.ts'),
      'utf8'
    )
    expect(runner).toContain('runInstallationAgentLoop')
    expect(runner).not.toContain('pre-C1')
    expect(runner).not.toMatch(/fallback \(pre-C1 loop\)/)

    const loop = readFileSync(
      join(simRoot, 'lib/agent-installations/chat/agent-loop.ts'),
      'utf8'
    )
    expect(loop).toContain('INSTALLATION_AGENT_SYSTEM_PROMPT')
    expect(loop).toContain('dispatchInstallationAgentTool')
    expect(loop).toContain('RUN_INSTALLATION_TOOL_NAME')
  })
})
