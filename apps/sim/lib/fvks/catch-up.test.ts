import { describe, expect, it } from 'vitest'
import { parseFvksListEventsResult } from '@/lib/fvks/catch-up'
import { isCursorAhead } from '@/lib/fvks/connection-store'

describe('parseFvksListEventsResult', () => {
  it('reads top-level events and next_cursor', () => {
    const page = parseFvksListEventsResult({
      events: [{ id: 'e1', type: 'recording.stopped', cursor: '10' }],
      next_cursor: '11',
    })
    expect(page.events).toHaveLength(1)
    expect(page.nextCursor).toBe('11')
  })

  it('reads structuredContent', () => {
    const page = parseFvksListEventsResult({
      structuredContent: {
        events: [{ id: 'e2', type: 'meeting.ended' }],
        next_cursor: null,
      },
    })
    expect(page.events[0]?.id).toBe('e2')
    expect(page.nextCursor).toBeNull()
  })

  it('parses JSON text content blocks', () => {
    const page = parseFvksListEventsResult({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            events: [{ id: 'e3', type: 'recording.saved', cursor: '3' }],
            next_cursor: 4,
          }),
        },
      ],
    })
    expect(page.events[0]?.id).toBe('e3')
    expect(page.nextCursor).toBe('4')
  })

  it('returns empty on garbage', () => {
    expect(parseFvksListEventsResult(null)).toEqual({ events: [], nextCursor: null })
    expect(parseFvksListEventsResult({ content: [{ type: 'text', text: 'not-json' }] })).toEqual({
      events: [],
      nextCursor: null,
    })
  })
})

describe('isCursorAhead', () => {
  it('compares numeric cursors as bigints', () => {
    expect(isCursorAhead('11', '10')).toBe(true)
    expect(isCursorAhead('9', '10')).toBe(false)
  })

  it('falls back to string compare', () => {
    expect(isCursorAhead('b', 'a')).toBe(true)
  })
})
