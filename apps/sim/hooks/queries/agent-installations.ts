'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  acceptAgentInstallationUpdateContract,
  deferAgentInstallationUpdateContract,
  installAgentReleaseContract,
  type InstallAgentReleaseResponse,
  listPendingAgentInstallationUpdatesContract,
  type ListPendingAgentInstallationUpdatesResponse,
  resolveAgentReleaseByTokenContract,
  type ResolveAgentReleaseByTokenResponse,
} from '@/lib/api/contracts/agent-installations'
import {
  AGENT_INSTALLATION_UPDATES_STALE_TIME,
  AGENT_RELEASE_BY_TOKEN_STALE_TIME,
  agentInstallationKeys,
} from '@/hooks/queries/utils/agent-installation-keys'

async function fetchReleaseByToken(
  token: string,
  signal?: AbortSignal
): Promise<ResolveAgentReleaseByTokenResponse> {
  return requestJson(resolveAgentReleaseByTokenContract, {
    params: { token },
    signal,
  })
}

async function fetchPendingUpdates(
  signal?: AbortSignal
): Promise<ListPendingAgentInstallationUpdatesResponse> {
  return requestJson(listPendingAgentInstallationUpdatesContract, { signal })
}

export function useAgentReleaseByToken(token: string | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: agentInstallationKeys.byToken(token ?? ''),
    queryFn: ({ signal }) => fetchReleaseByToken(token as string, signal),
    enabled: Boolean(token) && (options?.enabled ?? true),
    staleTime: AGENT_RELEASE_BY_TOKEN_STALE_TIME,
    retry: false,
  })
}

export function usePendingAgentInstallationUpdates(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: agentInstallationKeys.updates(),
    queryFn: ({ signal }) => fetchPendingUpdates(signal),
    enabled: options?.enabled ?? true,
    staleTime: AGENT_INSTALLATION_UPDATES_STALE_TIME,
  })
}

export function useInstallAgentRelease() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      shareToken: string
      workspaceId: string
      credentialBindings: Record<string, string>
    }) => requestJson(installAgentReleaseContract, { body }),
    onSuccess: async (result: InstallAgentReleaseResponse, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: agentInstallationKeys.updates() }),
        queryClient.invalidateQueries({
          queryKey: agentInstallationKeys.byToken(variables.shareToken),
        }),
      ])
      return result
    },
  })
}

export function useAcceptAgentInstallationUpdate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (installationId: string) =>
      requestJson(acceptAgentInstallationUpdateContract, {
        params: { id: installationId },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentInstallationKeys.all })
    },
  })
}

export function useDeferAgentInstallationUpdate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (installationId: string) =>
      requestJson(deferAgentInstallationUpdateContract, {
        params: { id: installationId },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentInstallationKeys.updates() })
      await queryClient.invalidateQueries({ queryKey: agentInstallationKeys.all })
    },
  })
}
