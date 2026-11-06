'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  acceptAgentInstallationUpdateContract,
  deferAgentInstallationUpdateContract,
  executeAgentInstallationContract,
  type ExecuteAgentInstallationResponse,
  getInstallationChatContract,
  type GetInstallationChatResponse,
  installAgentReleaseContract,
  type InstallAgentReleaseResponse,
  listAgentInstallationsContract,
  type ListAgentInstallationsResponse,
  listPendingAgentInstallationUpdatesContract,
  type ListPendingAgentInstallationUpdatesResponse,
  resolveAgentReleaseByTokenContract,
  type ResolveAgentReleaseByTokenResponse,
  revokeAgentInstallationContract,
} from '@/lib/api/contracts/agent-installations'
import {
  publishAgentReleaseContract,
  type PublishAgentReleaseResponse,
} from '@/lib/api/contracts/agent-releases'
import {
  AGENT_INSTALLATION_CHAT_STALE_TIME,
  AGENT_INSTALLATION_UPDATES_STALE_TIME,
  AGENT_INSTALLATIONS_LIST_STALE_TIME,
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

async function fetchAgentInstallations(
  signal?: AbortSignal
): Promise<ListAgentInstallationsResponse> {
  return requestJson(listAgentInstallationsContract, { signal })
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

/** Session list of active Installations for agent-home sidebar (U1). */
export function useAgentInstallations(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: agentInstallationKeys.list(),
    queryFn: ({ signal }) => fetchAgentInstallations(signal),
    enabled: options?.enabled ?? true,
    staleTime: AGENT_INSTALLATIONS_LIST_STALE_TIME,
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
        queryClient.invalidateQueries({ queryKey: agentInstallationKeys.list() }),
        queryClient.invalidateQueries({ queryKey: agentInstallationKeys.updates() }),
        queryClient.invalidateQueries({
          queryKey: agentInstallationKeys.byToken(variables.shareToken),
        }),
      ])
      return result
    },
  })
}
/** Session Publish → AgentRelease + Install share URL (`/install/{token}`). */
export function usePublishAgentRelease() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (workflowId: string): Promise<PublishAgentReleaseResponse> =>
      requestJson(publishAgentReleaseContract, {
        params: { id: workflowId },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentInstallationKeys.updates() })
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

export function useRevokeAgentInstallation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (installationId: string) =>
      requestJson(revokeAgentInstallationContract, {
        params: { id: installationId },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentInstallationKeys.all })
    },
  })
}

/** Session execute of a pinned Installation under installer identity (#6). */
export function useExecuteAgentInstallation() {
  return useMutation({
    mutationFn: ({
      installationId,
      input,
      triggerBlockId,
      signal,
    }: {
      installationId: string
      input?: unknown
      triggerBlockId?: string
      signal?: AbortSignal
    }): Promise<ExecuteAgentInstallationResponse> =>
      requestJson(executeAgentInstallationContract, {
        params: { id: installationId },
        body: {
          input,
          ...(triggerBlockId ? { triggerBlockId } : {}),
        },
        signal,
      }),
  })
}

async function fetchInstallationChat(
  installationId: string,
  signal?: AbortSignal
): Promise<GetInstallationChatResponse> {
  return requestJson(getInstallationChatContract, {
    params: { id: installationId },
    signal,
  })
}

/** Session GET: InstallationThread history for pane hydrate after reload (C3). */
export function useInstallationChat(installationId: string | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: agentInstallationKeys.chat(installationId ?? ''),
    queryFn: ({ signal }) => fetchInstallationChat(installationId as string, signal),
    enabled: Boolean(installationId) && (options?.enabled ?? true),
    staleTime: AGENT_INSTALLATION_CHAT_STALE_TIME,
  })
}
