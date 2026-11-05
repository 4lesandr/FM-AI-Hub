'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  installAgentReleaseContract,
  resolveAgentReleaseByTokenContract,
  type ResolveAgentReleaseByTokenResponse,
} from '@/lib/api/contracts/agent-installations'
import { useSession } from '@/lib/auth/client'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'

/**
 * Minimal Install-by-link wire for share URLs from Publish (`/install/{token}`).
 * Full Accept/Defer UI is slice #5; this only resolves + posts Install.
 */
export function InstallByToken() {
  const params = useParams<{ token: string }>()
  const router = useRouter()
  const { data: session, isPending: sessionPending } = useSession()
  const token = typeof params?.token === 'string' ? params.token : ''

  const [meta, setMeta] = useState<ResolveAgentReleaseByTokenResponse | null>(null)
  const [workspaceId, setWorkspaceId] = useState('')
  const [bindings, setBindings] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [doneId, setDoneId] = useState<string | null>(null)

  const callbackUrl = useMemo(() => `/install/${encodeURIComponent(token)}`, [token])

  const load = useCallback(async () => {
    if (!token) return
    setError(null)
    try {
      const data = await requestJson(resolveAgentReleaseByTokenContract, {
        params: { token },
      })
      setMeta(data)
      if (data.installation?.workspaceId) {
        setWorkspaceId(data.installation.workspaceId)
      }
      setDoneId(data.installation?.id ?? null)
    } catch (err) {
      setMeta(null)
      setError(err instanceof ApiClientError ? err.message : 'Failed to resolve install link')
    }
  }, [token])

  useEffect(() => {
    if (sessionPending) return
    if (!session?.user) return
    void load()
  }, [sessionPending, session?.user, load])

  const onInstall = async () => {
    if (!token || !workspaceId.trim()) {
      setError('Workspace id is required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await requestJson(installAgentReleaseContract, {
        body: {
          shareToken: token,
          workspaceId: workspaceId.trim(),
          credentialBindings: bindings,
        },
      })
      setDoneId(result.installationId)
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Install failed')
    } finally {
      setBusy(false)
    }
  }

  if (sessionPending) {
    return <p style={{ padding: 24 }}>Loading session…</p>
  }

  if (!session?.user) {
    return (
      <main style={{ padding: 24, maxWidth: 480, fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Install agent</h1>
        <p style={{ marginBottom: 16 }}>Sign in to install this agent for yourself.</p>
        <button
          type="button"
          onClick={() => router.push(buildAuthCrossLink('/login', { callbackUrl }))}
        >
          Sign in
        </button>
      </main>
    )
  }

  return (
    <main style={{ padding: 24, maxWidth: 560, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>Install agent</h1>
      {error ? <p style={{ color: '#b00020' }}>{error}</p> : null}
      {!meta && !error ? <p>Resolving link…</p> : null}
      {meta ? (
        <>
          <p style={{ marginBottom: 4 }}>
            <strong>{meta.workflowName}</strong> · v{meta.version}
          </p>
          {meta.workflowDescription ? (
            <p style={{ marginBottom: 16, opacity: 0.8 }}>{meta.workflowDescription}</p>
          ) : null}

          <label style={{ display: 'block', marginBottom: 12 }}>
            Workspace id
            <input
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 4 }}
              placeholder="ws_…"
            />
          </label>

          {meta.credentialSlots.length > 0 ? (
            <fieldset style={{ marginBottom: 16 }}>
              <legend>Your credentials</legend>
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
                    style={{ display: 'block', width: '100%', marginTop: 4 }}
                    placeholder="credential id"
                  />
                </label>
              ))}
            </fieldset>
          ) : (
            <p style={{ marginBottom: 16, opacity: 0.7 }}>No credential slots required.</p>
          )}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button type="button" disabled={busy} onClick={() => void onInstall()}>
              {busy ? 'Installing…' : doneId ? 'Update install' : 'Install for myself'}
            </button>
            {doneId ? (
              <button type="button" onClick={() => router.push(APP_ENTRY_PATH)}>
                Go home
              </button>
            ) : null}
          </div>
          {doneId ? (
            <p style={{ marginTop: 12, opacity: 0.7 }}>Installed as {doneId}</p>
          ) : null}
        </>
      ) : null}
    </main>
  )
}
