'use client'

import { type RefObject, useCallback, useMemo, useRef, useState } from 'react'
import { Button, usePrefersReducedMotion } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { ApiClientError } from '@/lib/api/client/errors'
import { useSession } from '@/lib/auth/client'
import { DesktopTitleBarLane } from '@/app/_shell/desktop-title-bar'
import {
  ChatErrorState,
  ChatHeader,
  ChatInput,
  ChatLoadingState,
  type ChatMessage,
  ChatMessageContainer,
} from '@/app/(interfaces)/chat/components'
import { CHAT_ERROR_MESSAGES, CHAT_REQUEST_TIMEOUT_MS } from '@/app/(interfaces)/chat/constants'
import { InterfacesShell } from '@/app/(interfaces)/components'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { useExecuteAgentInstallation } from '@/hooks/queries/agent-installations'
import { useGitHubStars } from '@/hooks/queries/github-stars'
import { useMobileViewport } from '@/hooks/use-mobile-viewport'
import { useRouter, useSearchParams } from 'next/navigation'

const logger = createLogger('InstallationChat')

const NEAR_BOTTOM_THRESHOLD_PX = 100

function formatInstallationOutput(output: unknown): string {
  if (output === null || output === undefined) return ''
  if (typeof output === 'string') return output
  if (typeof output === 'object') {
    return `\`\`\`json\n${JSON.stringify(output, null, 2)}\n\`\`\``
  }
  return String(output)
}

function ChatViewport({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useMobileViewport({ ref })
  return (
    <div
      ref={ref}
      className='light desktop-title-bar-page fixed inset-0 z-[var(--z-dropdown)] flex flex-col bg-[var(--bg)] text-[var(--text-primary)] max-md:top-[var(--mobile-viewport-top,0px)] max-md:bottom-auto max-md:h-[var(--mobile-viewport-height,100dvh)] max-md:min-h-0!'
    >
      {children}
    </div>
  )
}

interface InstallationChatProps {
  installationId: string
}

/**
 * Full-screen Installation chat — same (interfaces)/chat kit as deployed chat.
 * Messages run through POST /api/agent-installations/[id]/execute (installer identity).
 * Author workflow editor is not opened; graph is not editable here.
 */
export function InstallationChat({ installationId }: InstallationChatProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const titleParam = searchParams.get('title')?.trim()
  const prefersReducedMotion = usePrefersReducedMotion()
  const { data: session, isPending: sessionPending } = useSession()
  const { data: starCount } = useGitHubStars()
  const executeMutation = useExecuteAgentInstallation()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [fatalError, setFatalError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const stickToBottomRef = useRef(true)
  const ignoreScrollRef = useRef(false)

  const chatConfig = useMemo(
    () => ({
      title: titleParam || 'Agent',
      description: 'Чат с установленным агентом. Сообщения выполняются от вашего доступа.',
      customizations: {
        headerText: titleParam || 'Agent',
        welcomeMessage: 'Напишите сообщение — ответ пойдёт через вашу Installation.',
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

  const stopRequest = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsLoading(false)
  }

  const handleSendMessage = async (messageToSend: string) => {
    if (!messageToSend.trim() || isLoading) return
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
      // Chat trigger shape: workflow_input = { input: "<message>" } (#6 execute path).
      const result = await executeMutation.mutateAsync({
        installationId,
        input: { input: messageToSend },
        signal: abortController.signal,
      })

      window.clearTimeout(timeoutId)

      if (result.status === 'failed' || result.error) {
        const errText =
          typeof result.error === 'string'
            ? result.error
            : result.error &&
                typeof result.error === 'object' &&
                'message' in result.error &&
                typeof (result.error as { message?: unknown }).message === 'string'
              ? (result.error as { message: string }).message
              : CHAT_ERROR_MESSAGES.GENERIC_ERROR
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            content: errText,
            type: 'assistant',
            timestamp: new Date(),
          },
        ])
      } else {
        const content =
          formatInstallationOutput(result.output) ||
          (result.status === 'completed' ? 'Готово.' : `Статус: ${result.status}`)
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            content,
            type: 'assistant',
            timestamp: new Date(),
          },
        ])
      }
      scrollToBottom({ behavior: 'auto' })
    } catch (error) {
      window.clearTimeout(timeoutId)
      if (error instanceof Error && error.name === 'AbortError') {
        logger.info('Installation chat request aborted')
        return
      }
      logger.error('Installation chat execute failed', { error })
      const message =
        error instanceof ApiClientError
          ? error.message
          : error instanceof Error
            ? error.message
            : CHAT_ERROR_MESSAGES.GENERIC_ERROR
      setMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          content: message || CHAT_ERROR_MESSAGES.GENERIC_ERROR,
          type: 'assistant',
          timestamp: new Date(),
        },
      ])
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null
      }
      setIsLoading(false)
    }
  }

  if (sessionPending) {
    return (
      <InterfacesShell>
        <ChatLoadingState />
      </InterfacesShell>
    )
  }

  if (!session?.user) {
    const callbackUrl = `/installations/${encodeURIComponent(installationId)}/chat${
      titleParam ? `?title=${encodeURIComponent(titleParam)}` : ''
    }`
    return (
      <InterfacesShell>
        <ChatErrorState error='Войдите, чтобы открыть чат Installation.' />
        <div className='flex justify-center pb-10'>
          <Button
            type='button'
            onClick={() => router.push(buildAuthCrossLink('/login', { callbackUrl }))}
          >
            Войти
          </Button>
        </div>
      </InterfacesShell>
    )
  }

  if (fatalError) {
    return (
      <InterfacesShell>
        <ChatErrorState error={fatalError} />
      </InterfacesShell>
    )
  }

  return (
    <ChatViewport>
      <DesktopTitleBarLane />
      <ChatHeader chatConfig={chatConfig} starCount={starCount ?? ''} />

      <ChatMessageContainer
        messages={displayMessages}
        isLoading={isLoading}
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
            isStreaming={isLoading}
            onStopStreaming={stopRequest}
          />
        </div>
      </div>
    </ChatViewport>
  )
}
