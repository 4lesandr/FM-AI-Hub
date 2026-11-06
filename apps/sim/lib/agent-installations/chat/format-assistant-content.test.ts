import { describe, expect, it } from 'bun:test'
import {
  chunkTextForStream,
  formatInstallationAssistantContent,
} from '@/lib/agent-installations/chat/format-assistant-content'

describe('formatInstallationAssistantContent', () => {
  it('passes through strings', () => {
    expect(formatInstallationAssistantContent('hello')).toBe('hello')
  })

  it('json-fences objects', () => {
    expect(formatInstallationAssistantContent({ a: 1 })).toContain('```json')
    expect(formatInstallationAssistantContent({ a: 1 })).toContain('"a": 1')
  })
})

describe('chunkTextForStream', () => {
  it('splits into fixed-size chunks', () => {
    expect(chunkTextForStream('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  })

  it('returns empty for empty input', () => {
    expect(chunkTextForStream('')).toEqual([])
  })
})
