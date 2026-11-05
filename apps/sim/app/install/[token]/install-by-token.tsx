'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AuthButton as Chip,
  AuthSelect as ChipSelect,
  type AuthSelectOption as ChipSelectOption,
  AuthInput,
  AuthLabel as Label,
  AuthStack,
} from '@sim/auth-ui'
import { cn } from '@sim/emcn'
import { useParams, useRouter } from 'next/navigation'
import { ApiClientError } from '@/lib/api/client/errors'
import { useSession } from '@/lib/auth/client'
import { installationChatPath } from '@/lib/navigation/installation-paths'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { AuthFormMessage, AuthHeader, AuthSubmitButton } from '@/app/(auth)/components'
import { AUTH_BUTTON_CLASS } from '@/app/(auth)/components/constants'
import InstallLayout from '@/app/install/components/layout'
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
 * Auth-shell + auth-ui controls — same kit as invite/CLI consent, not a debug form.
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

  const workspaceOptions = useMemo<ChipSelectOption[]>(
    () =>
      (workspacesQuery.data ?? []).map((ws) => ({
        label: ws.name,
        value: ws.id,
      })),
    [workspacesQuery.data]
  )

  const updatePending =
    meta?.installation?.updatePolicy === 'pending' ||
    meta?.installation?.updatePolicy === 'deferred'
  const busy =
    installMutation.isPending ||
    acceptMutation.isPending ||
    deferMutation.isPending ||
    revokeMutation.isPending

  const installationId = meta?.installation?.id ?? doneId

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

  const openChat = (id: string) => {
    router.push(installationChatPath(id, { title: meta?.workflowName }))
  }

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
      router.push(installationChatPath(result.installationId, { title: meta?.workflowName }))
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
    return (
      <InstallLayout>
        <AuthStack>
          <AuthHeader title='Поставить себе' description='Загрузка сессии…' />
        </AuthStack>
      </InstallLayout>
    )
  }

  if (!session?.user) {
    return (
      <InstallLayout>
        <AuthStack>
          <AuthHeader
            title='Поставить себе'
            description='Войдите, чтобы установить этого агента себе.'
          />
          <AuthSubmitButton
            type='button'
            loadingLabel=''
            onClick={() => router.push(buildAuthCrossLink('/login', { callbackUrl }))}
          >
            Войти
          </AuthSubmitButton>
        </AuthStack>
      </InstallLayout>
    )
  }

  return (
    <InstallLayout>
      <AuthStack>
        <AuthHeader
          title='Поставить себе'
          description={
            meta
              ? `${meta.workflowName} · v${meta.version}${
                  meta.workflowDescription ? ` — ${meta.workflowDescription}` : ''
                }`
              : releaseQuery.isLoading
                ? 'Открываем ссылку…'
                : 'Установка агента по ссылке'
          }
        />

        {errorMessage ? (
          <AuthFormMessage type='error' align='center'>
            {errorMessage}
          </AuthFormMessage>
        ) : null}

        {updatePending && meta?.installation ? (
          <div className='au:w-full au:space-y-3 au:rounded-md au:border au:border-[var(--auth-border)] au:bg-[var(--auth-surface)] au:p-4'>
            <p className='au:text-[var(--auth-primary)] au:text-control au:font-medium'>
              Есть обновление
            </p>
            <p className='au:text-[var(--auth-secondary)] au:text-caption'>
              У вас v{meta.installation.pinnedVersion}
              {meta.version !== meta.installation.pinnedVersion
                ? `, доступна v${meta.version}`
                : ''}
              . Принять новую версию или отложить?
            </p>
            <div className='au:flex au:flex-col au:gap-2'>
              <AuthSubmitButton
                type='button'
                disabled={busy}
                loading={acceptMutation.isPending}
                loadingLabel='Принимаем…'
                onClick={() => void onAccept()}
              >
                Accept
              </AuthSubmitButton>
              <Chip
                fullWidth
                disabled={busy}
                onClick={() => void onDefer()}
                className={cn(AUTH_BUTTON_CLASS, 'au:border au:border-[var(--auth-border)]')}
              >
                {deferMutation.isPending ? 'Откладываем…' : 'Defer'}
              </Chip>
            </div>
          </div>
        ) : null}

        {!updatePending && meta ? (
          <div className='au:w-full au:space-y-[var(--auth-group-gap)]'>
            <div className='au:flex au:flex-col au:gap-2'>
              <Label
                htmlFor='install-workspace'
                className='au:text-[var(--auth-secondary)] au:text-control'
              >
                Workspace
              </Label>
              <ChipSelect
                id='install-workspace'
                aria-label='Workspace'
                options={workspaceOptions}
                value={workspaceId || undefined}
                onChange={setWorkspaceId}
                disabled={busy || workspacesQuery.isLoading}
                displayLabel={
                  workspacesQuery.isLoading && !workspaceId ? 'Загрузка…' : undefined
                }
                placeholder='Выберите workspace'
                searchable={workspaceOptions.length > 8}
                searchPlaceholder='Поиск workspace'
                fullWidth
                dropdownWidth='trigger'
              />
            </div>

            {meta.credentialSlots.length > 0 ? (
              <div className='au:space-y-3'>
                <p className='au:text-[var(--auth-secondary)] au:text-control'>Ваши credentials</p>
                {meta.credentialSlots.map((slot) => (
                  <div key={slot.key} className='au:flex au:flex-col au:gap-2'>
                    <Label
                      htmlFor={`cred-${slot.key}`}
                      className='au:text-[var(--auth-secondary)] au:text-caption'
                    >
                      {slot.blockName} / {slot.field}
                      {slot.serviceId ? ` (${slot.serviceId})` : ''}
                      {slot.required ? ' *' : ''}
                    </Label>
                    <AuthInput
                      id={`cred-${slot.key}`}
                      value={bindings[slot.key] ?? ''}
                      onChange={(event) =>
                        setBindings((prev) => ({ ...prev, [slot.key]: event.target.value }))
                      }
                      placeholder='credential id'
                      disabled={busy}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className='au:text-[var(--auth-secondary)] au:text-caption'>
                Credentials не требуются.
              </p>
            )}

            <div className='au:w-full au:space-y-2'>
              <AuthSubmitButton
                type='button'
                disabled={busy || !workspaceId}
                loading={installMutation.isPending}
                loadingLabel='Устанавливаем…'
                onClick={() => void onInstall()}
              >
                {doneId || meta.installation ? 'Обновить установку' : 'Поставить себе'}
              </AuthSubmitButton>

              {installationId ? (
                <>
                  <Chip
                    fullWidth
                    disabled={busy}
                    onClick={() => openChat(installationId)}
                    className={cn(AUTH_BUTTON_CLASS, 'au:border au:border-[var(--auth-border)]')}
                  >
                    Открыть чат
                  </Chip>
                  <Chip
                    fullWidth
                    disabled={busy}
                    onClick={() => void onRevoke()}
                    className={cn(AUTH_BUTTON_CLASS, 'au:border au:border-[var(--auth-border)]')}
                  >
                    {revokeMutation.isPending ? 'Отзываем…' : 'Отозвать установку'}
                  </Chip>
                </>
              ) : null}
            </div>

            {meta.installation && !updatePending ? (
              <p className='au:text-center au:text-[var(--auth-secondary)] au:text-caption'>
                Уже установлено · v{meta.installation.pinnedVersion} ·{' '}
                {meta.installation.updatePolicy}
              </p>
            ) : null}
          </div>
        ) : null}

        {updatePending && installationId ? (
          <div className='au:w-full au:space-y-2'>
            <Chip
              fullWidth
              disabled={busy}
              onClick={() => openChat(installationId)}
              className={cn(AUTH_BUTTON_CLASS, 'au:border au:border-[var(--auth-border)]')}
            >
              Открыть чат
            </Chip>
            <Chip
              fullWidth
              disabled={busy}
              onClick={() => void onRevoke()}
              className={cn(AUTH_BUTTON_CLASS, 'au:border au:border-[var(--auth-border)]')}
            >
              {revokeMutation.isPending ? 'Отзываем…' : 'Отозвать установку'}
            </Chip>
          </div>
        ) : null}
      </AuthStack>
    </InstallLayout>
  )
}
