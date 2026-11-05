'use client'

import { useMemo } from 'react'
import {
  AuthSelect as ChipSelect,
  type AuthSelectOption as ChipSelectOption,
  AuthLabel as Label,
} from '@sim/auth-ui'
import { getProviderIdFromServiceId } from '@/lib/oauth'
import { useWorkspaceCredentials } from '@/hooks/queries/credentials'
import { useOAuthCredentials } from '@/hooks/queries/oauth/credentials'

export interface InstallCredentialSlotView {
  key: string
  blockName: string
  field: string
  serviceId: string | null
  required: boolean
}

interface InstallCredentialPickerProps {
  slot: InstallCredentialSlotView
  workspaceId: string
  value: string
  onChange: (credentialId: string) => void
  disabled?: boolean
}

/**
 * Credential picker for Install-by-link slots.
 * Lists installer workspace credentials by serviceId → provider (existing list APIs).
 * No raw id entry — reduces prod-cred mistakes.
 */
export function InstallCredentialPicker({
  slot,
  workspaceId,
  value,
  onChange,
  disabled = false,
}: InstallCredentialPickerProps) {
  const serviceId = slot.serviceId?.trim() || ''
  const providerId = serviceId ? getProviderIdFromServiceId(serviceId) : ''
  const hasService = Boolean(providerId)

  const oauthQuery = useOAuthCredentials(providerId || undefined, {
    enabled: hasService && Boolean(workspaceId),
    workspaceId: workspaceId || undefined,
  })

  const workspaceQuery = useWorkspaceCredentials({
    workspaceId: workspaceId || undefined,
    enabled: !hasService && Boolean(workspaceId),
  })

  const loading = hasService ? oauthQuery.isFetching : workspaceQuery.isFetching

  const options = useMemo<ChipSelectOption[]>(() => {
    const listed: ChipSelectOption[] = hasService
      ? (oauthQuery.data ?? []).map((credential) => ({
          label: credential.name,
          value: credential.id,
        }))
      : (workspaceQuery.data ?? [])
          .filter((credential) => credential.type === 'oauth' || credential.type === 'service_account')
          .map((credential) => ({
            label: credential.displayName,
            value: credential.id,
          }))

    if (!slot.required) {
      return [{ label: 'Не выбирать', value: '' }, ...listed]
    }
    return listed
  }, [hasService, oauthQuery.data, workspaceQuery.data, slot.required])

  const emptyHint =
    !loading && workspaceId && options.filter((option) => option.value).length === 0
      ? hasService
        ? 'В этом workspace нет credentials для сервиса'
        : 'В этом workspace нет credentials'
      : null

  return (
    <div className='au:flex au:flex-col au:gap-2'>
      <Label
        htmlFor={`cred-${slot.key}`}
        className='au:text-[var(--auth-secondary)] au:text-caption'
      >
        {slot.blockName} / {slot.field}
        {serviceId ? ` (${serviceId})` : ''}
        {slot.required ? ' *' : ''}
      </Label>
      <ChipSelect
        id={`cred-${slot.key}`}
        aria-label={`Credential for ${slot.blockName} ${slot.field}`}
        options={options}
        value={value || undefined}
        onChange={onChange}
        disabled={disabled || !workspaceId || loading}
        displayLabel={loading && !value ? 'Загрузка…' : undefined}
        placeholder={
          !workspaceId
            ? 'Сначала выберите workspace'
            : emptyHint
              ? emptyHint
              : 'Выберите credential'
        }
        searchable={options.length > 8}
        searchPlaceholder='Поиск credential'
        fullWidth
        dropdownWidth='trigger'
      />
      {emptyHint ? (
        <p className='au:text-[var(--auth-secondary)] au:text-caption'>{emptyHint}</p>
      ) : null}
    </div>
  )
}
