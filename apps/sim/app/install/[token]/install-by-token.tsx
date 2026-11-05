'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ApiClientError } from '@/lib/api/client/errors'
import { useSession } from '@/lib/auth/client'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import {
  useAcceptAgentInstallationUpdate,
  useAgentReleaseByToken,
  useDeferAgentInstallationUpdate,
  useInstallAgentRelease,
  useRevokeAgentInstallation,
} from '@/hooks/queries/agent-installations'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'

/**
 * Install-by-link page for Publish share URLs (`/install/{token}`).
 * No catalog / fork UX — only «Поставить себе», Accept/Defer, and revoke.
 */
export function InstallByToken() {
  const params = useParams<{ token: string }>()
  const router = useRouter()
  const { data: session, isPending: sessionPending } = useSession()
  const token = typeof params?.token === 'string' ? params.token : ''
  const signedIn = Boolean(session?.user)

  const releaseQuery = useAgentReleaseByToken(token, { enabled: signedIn && Boolean(token) })
  const workspacesQuery = useWorkspacesQuery(signedIn)
  const installMutation = useInstallAgentRelease()
  const acceptMutation = useAcceptAgentInstallationUpdate()
  const deferMutation = useDeferAgentInstallationUpdate()
  const revokeMutation = useRevokeAgentInstallation()

  const meta = releaseQuery.data ?? null
  const [workspaceId, setWorkspaceId] = useState('')
  const [bindings, setBindings] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [doneId, setDoneId] = useState<string | null>(null)

  const callbackUrl = useMemo(() => `/install/${encodeURIComponent(token)}`, [token])

  useEffect(() => {
    if (!meta) return
    if (meta.installation?.workspaceId) {
      setWorkspaceId(meta.installation.workspaceId)
      setDoneId(meta.installation.id)
      return
    }
    const first = workspacesQuery.data?.[0]?.id
    if (first && !workspaceId) setWorkspaceId(first)
  }, [meta, workspacesQuery.data, workspaceId])

  const updatePending =
    meta?.installation?.updatePolicy === 'pending' ||
    meta?.installation?.updatePolicy === 'deferred'
  const busy =
    installMutation.isPending ||
    acceptMutation.isPending ||
    deferMutation.isPending ||
    revokeMutation.isPending

  const errorMessage =
    formError ??
    (releaseQuery.error instanceof ApiClientError
      ? releaseQuery.error.message
      : releaseQuery.error
        ? 'Не удалось открыть ссылку установки'
        : null) ??
    (installMutation.error instanceof ApiClientError
      ? installMutation.error.message
      : installMutation.error
        ? 'Установка не удалась'
        : null) ??
    (acceptMutation.error instanceof ApiClientError
      ? acceptMutation.error.message
      : acceptMutation.error
        ? 'Не удалось принять обновление'
        : null) ??
    (deferMutation.error instanceof ApiClientError
      ? deferMutation.error.message
      : deferMutation.error
        ? 'Не удалось отложить обновление'
        : null) ??
    (revokeMutation.error instanceof ApiClientError
      ? revokeMutation.error.message
      : revokeMutation.error
        ? 'Не удалось отозвать установку'
        : null)

  const onInstall = async () => {
    if (!token || !workspaceId.trim()) {
      setFormError('Выберите workspace')
      return
    }
    setFormError(null)
    try {
      const result = await installMutation.mutateAsync({
        shareToken: token,
        workspaceId: workspaceId.trim(),
        credentialBindings: bindings,
      })
      setDoneId(result.installationId)
    } catch {
      // surfaced via mutation error
    }
  }

  const onAccept = async () => {
    if (!meta?.installation?.id) return
    setFormError(null)
    try {
      const result = await acceptMutation.mutateAsync(meta.installation.id)
      setDoneId(result.installationId)
    } catch {
      // surfaced via mutation error
    }
  }

  const onDefer = async () => {
    if (!meta?.installation?.id) return
    setFormError(null)
    try {
      await deferMutation.mutateAsync(meta.installation.id)
    } catch {
      // surfaced via mutation error
    }
  }

  const onRevoke = async () => {
    const installationId = meta?.installation?.id ?? doneId
    if (!installationId) return
    setFormError(null)
    try {
      await revokeMutation.mutateAsync(installationId)
      setDoneId(null)
    } catch {
      // surfaced via mutation error
    }
  }

  if (sessionPending) {
    return <p style={{ padding: 24 }}>Загрузка сессии…</p>
  }

  if (!session?.user) {
    return (
      <main style={pageStyle}>
        <h1 style={titleStyle}>Поставить себе</h1>
        <p style={{ marginBottom: 16 }}>Войдите, чтобы установить этого агента себе.</p>
        <button
          type='button'
          onClick={() => router.push(buildAuthCrossLink('/login', { callbackUrl }))}
        >
          Войти
        </button>
      </main>
    )
  }

  return (
    <main style={pageStyle}>
      <h1 style={titleStyle}>Поставить себе</h1>
      {errorMessage ? <p style={{ color: '#b00020' }}>{errorMessage}</p> : null}
      {releaseQuery.isLoading && !meta ? <p>Открываем ссылку…</p> : null}

      {meta ? (
        <>
          <p style={{ marginBottom: 4 }}>
            <strong>{meta.workflowName}</strong> · v{meta.version}
          </p>
          {meta.workflowDescription ? (
            <p style={{ marginBottom: 16, opacity: 0.8 }}>{meta.workflowDescription}</p>
          ) : null}

          {updatePending && meta.installation ? (
            <section
              style={{
                marginBottom: 20,
                padding: '12px 14px',
                border: '1px solid #c9a227',
                background: '#fff8e1',
                borderRadius: 6,
              }}
              aria-live='polite'
            >
              <p style={{ margin: '0 0 8px', fontWeight: 600 }}>есть обновление</p>
              <p style={{ margin: '0 0 12px', opacity: 0.85, fontSize: 14 }}>
                У вас v{meta.installation.pinnedVersion}
                {meta.version !== meta.installation.pinnedVersion
                  ? `, доступна v${meta.version}`
                  : ''}
                . Принять новую версию или отложить?
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type='button' disabled={busy} onClick={() => void onAccept()}>
                  {acceptMutation.isPending ? 'Принимаем…' : 'Accept'}
                </button>
                <button type='button' disabled={busy} onClick={() => void onDefer()}>
                  {deferMutation.isPending ? 'Откладываем…' : 'Defer'}
                </button>
              </div>
            </section>
          ) : null}

          {!updatePending ? (
            <>
              <label style={{ display: 'block', marginBottom: 12 }}>
                Workspace
                <select
                  value={workspaceId}
                  onChange={(event) => setWorkspaceId(event.target.value)}
                  style={{ display: 'block', width: '100%', marginTop: 4, padding: 6 }}
                >
                  <option value='' disabled>
                    {workspacesQuery.isLoading ? 'Загрузка…' : 'Выберите workspace'}
                  </option>
                  {(workspacesQuery.data ?? []).map((ws) => (
                    <option key={ws.id} value={ws.id}>
                      {ws.name}
                    </option>
                  ))}
                </select>
              </label>

              {meta.credentialSlots.length > 0 ? (
                <fieldset style={{ marginBottom: 16 }}>
                  <legend>Ваши credentials</legend>
                  {meta.credentialSlots.map((slot) => (
                    <label key={slot.key} style={{ display: 'block', marginBottom: 8 }}>
                      {slot.blockName} / {slot.field}
                      {slot.serviceId ? ` (${slot.serviceId})` : ''}
                      {slot.required ? ' *' : ''}
                      <input
                        value={bindings[slot.key] ?? ''}
                        onChange={(event) =>
                          setBindings((prev) => ({ ...prev, [slot.key]: event.target.value }))
                        }
                        style={{ display: 'block', width: '100%', marginTop: 4, padding: 6 }}
                        placeholder='credential id'
                      />
                    </label>
                  ))}
                </fieldset>
              ) : (
                <p style={{ marginBottom: 16, opacity: 0.7 }}>Credentials не требуются.</p>
              )}

              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type='button' disabled={busy || !workspaceId} onClick={() => void onInstall()}>
                  {installMutation.isPending
                    ? 'Устанавливаем…'
                    : doneId
                      ? 'Обновить установку'
                      : 'Поставить себе'}
                </button>
                {doneId || meta.installation ? (
                  <button type='button' disabled={busy} onClick={() => void onRevoke()}>
                    {revokeMutation.isPending ? 'Отзываем…' : 'Отозвать установку'}
                  </button>
                ) : null}
                {doneId ? (
                  <button type='button' onClick={() => router.push(APP_ENTRY_PATH)}>
                    На главную
                  </button>
                ) : null}
              </div>
            </>
          ) : null}

          {updatePending && meta.installation ? (
            <div style={{ marginTop: 16 }}>
              <button type='button' disabled={busy} onClick={() => void onRevoke()}>
                {revokeMutation.isPending ? 'Отзываем…' : 'Отозвать установку'}
              </button>
            </div>
          ) : null}

          {doneId && !updatePending ? (
            <p style={{ marginTop: 12, opacity: 0.7 }}>Установлено: {doneId}</p>
          ) : null}
          {meta.installation && !updatePending ? (
            <p style={{ marginTop: 8, opacity: 0.7 }}>
              Уже установлено · v{meta.installation.pinnedVersion} ·{' '}
              {meta.installation.updatePolicy}
            </p>
          ) : null}
        </>
      ) : null}
    </main>
  )
}

const pageStyle: CSSProperties = {
  padding: 24,
  maxWidth: 560,
  fontFamily: 'system-ui, sans-serif',
}

const titleStyle: CSSProperties = {
  fontSize: 20,
  marginBottom: 8,
}
