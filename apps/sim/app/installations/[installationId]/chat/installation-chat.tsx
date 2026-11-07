'use client'

import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, usePrefersReducedMotion } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { InstallationUpdateControls } from '@/app/workspace/[workspaceId]/apps/components/installation-update-controls'
import {
  ChatErrorState,
  ChatHeader,
  ChatInput,
  ChatLoadingState,
  type ChatMessage,
  ChatMessageContainer,
} from '@/app/(interfaces)/chat/components'
import { CHAT_ERROR_MESSAGES, CHAT_REQUEST_TIMEOUT_MS } from '@/app/(interfaces)/chat/constants'
import { useChatStreaming } from '@/app/(interfaces)/chat/hooks'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { useSession } from '@/lib/auth/client'
import {
  AGENT_STREAM_PROTOCOL_HEADER,
  AGENT_STREAM_PROTOCOL_V1,
} from '@/lib/workflows/streaming/agent-stream-protocol'
import { appsInstallationPath, legacyAppsInstallationPath } from '@/lib/navigation/installation-paths'
import {
  useInstallationChat,
  usePendingAgentInstallationUpdates,
} from '@/hooks/queries/agent-installations'
import { agentInstallationKeys } from '@/hooks/queries/utils/agent-installation-keys'
import { useGitHubStars } from '@/hooks/queries/github-stars'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter, useSearchParams } from 'next/navigation'

const logger = createLogger('InstallationChat')

const NEAR_BOTTOM_THRESHOLD_PX = 100

/** Fills the agent-home content pane under WorkspaceChrome (`/apps/{id}`). */
function ChatPane({ children }: { children: React.ReactNode }) {
  return (
    <div className='flex h-full min-h-0 flex-col bg-[var(--bg)] text-[var(--text-primary)]'>
      {children}
    </div>
  )
}

interface InstallationChatProps {
  installationId: string
}

/**
 * Installation chat engine in the agent-home pane (`/apps/{id}`).
 * Stream client + server InstallationThread history. C1 agent loop plugs into
 * the same POST …/chat SSE; this UI already consumes tool + chunk frames.
 * Identity stays installer via chat route → tools (run_installation).
 */
export function InstallationChat({ installationId }: InstallationChatProps) {
  const router = useRouter()
  const params = useParams<{ workspaceId?: string }>()
  const workspaceId = params.workspaceId
  const searchParams = useSearchParams()
  const titleParam = searchParams.get('title')?.trim()
  const prefersReducedMotion = usePrefersReducedMotion()
  const queryClient = useQueryClient()
  const { data: session, isPending: sessionPending } = useSession()
  const { data: starCount } = useGitHubStars()
  const {
    data: chatHistory,
    isPending: chatHistoryPending,
    error: chatHistoryError,
  } = useInstallationChat(installationId, {
    enabled: Boolean(session?.user),
  })
  const { data: pendingUpdates } = usePendingAgentInstallationUpdates({
    enabled: Boolean(session?.user),
  })
  const pendingUpdate = useMemo(
    () => pendingUpdates?.updates.find((update) => update.installationId === installationId),
    [pendingUpdates?.updates, installationId]
  )

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [historyHydrated, setHistoryHydrated] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [fatalError, setFatalError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const stickToBottomRef = useRef(true)
  const ignoreScrollRef = useRef(false)

  const { isStreamingResponse, abortControllerRef, stopStreaming, handleStreamedResponse } =
    useChatStreaming()

  const chatConfig = useMemo(
    () => ({
      title: titleParam || 'Agent',
      description: 'Чат с установленным приложением. История сохраняется на сервере.',
      customizations: {
        headerText: titleParam || 'Agent',
        welcomeMessage: 'Напишите сообщение — ответит агент этого приложения.',
      },
    }),
    [titleParam]
  )

  const welcomeChatMessage = useMemo<ChatMessage>(
    () => ({
      id: 'welcome',
      content: chatConfig.customizations.welcomeMessage,
      type: 'assistant',
      timestamp: new Date(),
      isInitialMessage: true,
    }),
    [chatConfig.customizations.welcomeMessage]
  )

  useEffect(() => {
    if (!chatHistory || historyHydrated) return
    setMessages(
      chatHistory.messages.map((row) => ({
        id: row.id,
        content: row.content,
        type: row.role,
        timestamp: new Date(row.createdAt),
      }))
    )
    setHistoryHydrated(true)
  }, [chatHistory, historyHydrated])

  useEffect(() => {
    setHistoryHydrated(false)
    setMessages([])
  }, [installationId])

  const displayMessages: ChatMessage[] = [welcomeChatMessage, ...messages]

  const scrollToBottom = (options?: { behavior?: ScrollBehavior; force?: boolean }) => {
    const behavior = prefersReducedMotion ? 'auto' : (options?.behavior ?? 'smooth')
    const force = options?.force === true
    if (!force && !stickToBottomRef.current) return
    if (!messagesEndRef.current) return

    if (force) {
      stickToBottomRef.current = true
      setShowScrollButton(false)
    }

    ignoreScrollRef.current = true
    messagesEndRef.current.scrollIntoView({ behavior })
    window.setTimeout(
      () => {
        ignoreScrollRef.current = false
      },
      behavior === 'smooth' ? 400 : 50
    )
  }

  const attachMessagesContainer = useCallback((node: HTMLDivElement | null) => {
    messagesContainerRef.current = node
    if (!node) return

    const handleScroll = () => {
      if (ignoreScrollRef.current) return
      const { scrollTop, scrollHeight, clientHeight } = node
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight
      const nearBottom = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX
      stickToBottomRef.current = nearBottom
      setShowScrollButton(!nearBottom)
    }

    node.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      node.removeEventListener('scroll', handleScroll)
      messagesContainerRef.current = null
    }
  }, [])

  const handleSendMessage = async (messageToSend: string) => {
    if (!messageToSend.trim() || isLoading || isStreamingResponse) return
    if (!installationId) {
      setFatalError(CHAT_ERROR_MESSAGES.CHAT_UNAVAILABLE)
      return
    }

    stickToBottomRef.current = true
    setShowScrollButton(false)

    const userMessage: ChatMessage = {
      id: generateId(),
      content: messageToSend,
      type: 'user',
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, userMessage])
    setIsLoading(true)

    const abortController = new AbortController()
    abortControllerRef.current = abortController
    const timeoutId = window.setTimeout(() => abortController.abort(), CHAT_REQUEST_TIMEOUT_MS)

    try {
      // boundary-raw-fetch: Installation chat returns SSE consumed by useChatStreaming
      const response = await fetch(`/api/agent-installations/${installationId}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          [AGENT_STREAM_PROTOCOL_HEADER]: AGENT_STREAM_PROTOCOL_V1,
        },
        body: JSON.stringify({ message: messageToSend }),
        credentials: 'same-origin',
        signal: abortController.signal,
      })

      window.clearTimeout(timeoutId)

      if (!response.ok) {
        let errorText = CHAT_ERROR_MESSAGES.GENERIC_ERROR
        try {
          const errorData = (await response.json()) as { error?: string }
          if (typeof errorData.error === 'string' && errorData.error.trim()) {
            errorText = errorData.error
          }
        } catch {
          // keep generic
        }
        throw new Error(errorText)
      }

      if (!response.body) {
        throw new Error('Response body is missing')
      }

      await handleStreamedResponse(
        response,
        setMessages,
        setIsLoading,
        () => scrollToBottom({ behavior: 'auto' }),
        { abortController }
      )

      await queryClient.invalidateQueries({
        queryKey: agentInstallationKeys.chat(installationId),
      })
    } catch (error) {
      window.clearTimeout(timeoutId)
      if (error instanceof Error && error.name === 'AbortError') {
        logger.info('Installation chat request aborted')
        setIsLoading(false)
        return
      }
      logger.error('Installation chat stream failed', { error })
      setIsLoading(false)
      const message =
        error instanceof Error && error.message
          ? error.message
          : CHAT_ERROR_MESSAGES.GENERIC_ERROR
      setMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          content: message,
          type: 'assistant',
          timestamp: new Date(),
        },
      ])
    }
  }

  if (sessionPending) {
    return (
      <ChatPane>
        <ChatLoadingState />
      </ChatPane>
    )
  }

  if (!session?.user) {
    // Login returns to agent home `/apps/{id}` (legacy `/installations/.../chat` redirects).
    const callbackUrl = workspaceId
      ? appsInstallationPath(workspaceId, installationId, { title: titleParam })
      : legacyAppsInstallationPath(installationId, { title: titleParam })
    return (
      <ChatPane>
        <ChatErrorState error='Войдите, чтобы открыть чат приложения.' />
        <div className='flex justify-center pb-10'>
          <Button
            type='button'
            onClick={() => router.push(buildAuthCrossLink('/login', { callbackUrl }))}
          >
            Войти
          </Button>
        </div>
      </ChatPane>
    )
  }

  if (chatHistoryPending && !historyHydrated) {
    return (
      <ChatPane>
        <ChatLoadingState />
      </ChatPane>
    )
  }

  if (chatHistoryError && !historyHydrated) {
    logger.error('Failed to load Installation chat history', { error: chatHistoryError })
    return (
      <ChatPane>
        <ChatErrorState error={CHAT_ERROR_MESSAGES.CHAT_UNAVAILABLE} />
      </ChatPane>
    )
  }

  if (fatalError) {
    return (
      <ChatPane>
        <ChatErrorState error={fatalError} />
      </ChatPane>
    )
  }

  return (
    <ChatPane>
      <ChatHeader chatConfig={chatConfig} starCount={starCount ?? ''} />
      {pendingUpdate && workspaceId ? (
        <InstallationUpdateControls
          workspaceId={workspaceId}
          installationId={pendingUpdate.installationId}
          pinnedVersion={pendingUpdate.pinnedVersion}
          latestVersion={pendingUpdate.latestVersion}
        />
      ) : null}

      <ChatMessageContainer
        messages={displayMessages}
        isLoading={isLoading || isStreamingResponse}
        showScrollButton={showScrollButton}
        messagesContainerRef={attachMessagesContainer}
        messagesEndRef={messagesEndRef as RefObject<HTMLDivElement>}
        scrollToBottom={() => scrollToBottom({ behavior: 'smooth', force: true })}
        chatConfig={chatConfig}
      />

      <div className='relative shrink-0 md:p-4 md:pb-6'>
        <div className='relative mx-auto max-w-3xl md:max-w-[748px]'>
          <ChatInput
            onSubmit={(value) => {
              void handleSendMessage(value)
            }}
            isStreaming={isLoading || isStreamingResponse}
            onStopStreaming={() => stopStreaming(setMessages)}
          />
        </div>
      </div>
    </ChatPane>
  )
}
