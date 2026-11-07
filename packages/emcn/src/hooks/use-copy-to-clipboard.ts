'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface UseCopyToClipboardOptions {
  /** How long the `copied` flag stays true before resetting. Defaults to 2000ms. */
  resetMs?: number
}

interface DeferredClipboardContent {
  /** Safe text that can be written immediately when promise-backed writes are unavailable. */
  fallback: string
  /** Produces the preferred text when the browser supports promise-backed clipboard items. */
  prepare: () => Promise<string>
}

export type ClipboardContent = string | DeferredClipboardContent

interface UseCopyToClipboardReturn {
  copied: boolean
  copy: (content: ClipboardContent) => Promise<boolean>
}

/**
 * Legacy copy for non-secure contexts (`http://` IP stands): Clipboard API is
 * unavailable outside https/localhost, so Publish "Copy link" otherwise fails silently.
 */
function writeTextViaExecCommand(text: string): void {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '0'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, text.length)
  const ok = document.execCommand('copy')
  document.body.removeChild(textarea)
  if (!ok) throw new Error('execCommand copy failed')
}

async function writePlainText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Fall through: insecure origin or denied permission.
    }
  }
  writeTextViaExecCommand(text)
}

/**
 * Starts an async clipboard write while the caller still has transient user activation.
 * Deferred text uses `ClipboardItem` when available and an immediate fallback otherwise.
 * Falls back to `document.execCommand('copy')` on http stands (no secure clipboard).
 */
export function writeTextToClipboard(content: ClipboardContent): Promise<void> {
  if (typeof content === 'string') return writePlainText(content)

  if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function') {
    const blob = Promise.resolve()
      .then(() => content.prepare())
      .then((value) => new Blob([value], { type: 'text/plain' }))
    return navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]).catch(() =>
      writePlainText(content.fallback)
    )
  }

  return writePlainText(content.fallback)
}

/**
 * Copy text to the clipboard with a transient `copied` flag for swap-icon
 * feedback (e.g. Copy → Check for ~2s).
 *
 * Replaces the `[copied, setCopied] + setTimeout` boilerplate that's been
 * duplicated across ~30 callsites. Each `copy()` call resets the timer so
 * back-to-back copies don't stack timeouts; the timer is cleared on unmount.
 *
 * @example
 *   const { copied, copy } = useCopyToClipboard()
 *   <button onClick={() => copy(value)}>
 *     {copied ? <Check /> : <Copy />}
 *   </button>
 */
export function useCopyToClipboard(
  options: UseCopyToClipboardOptions = {}
): UseCopyToClipboardReturn {
  const { resetMs = 2000 } = options
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const copy = useCallback(
    async (content: ClipboardContent): Promise<boolean> => {
      try {
        await writeTextToClipboard(content)
        setCopied(true)
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setCopied(false), resetMs)
        return true
      } catch {
        return false
      }
    },
    [resetMs]
  )

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  return { copied, copy }
}
