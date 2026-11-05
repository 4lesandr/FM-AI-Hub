import { describe, expect, it } from 'vitest'
import {
  extrasOfAccessToken,
  parseIdpAudiences,
  parseTokenSubject,
} from '@/lib/fvks/token-exchange'

describe('parseIdpAudiences', () => {
  it('parses slug=audience pairs', () => {
    const map = parseIdpAudiences('fvks=meet, wiki=wiki')
    expect(map.get('fvks')).toBe('meet')
    expect(map.get('wiki')).toBe('wiki')
  })

  it('ignores malformed pairs', () => {
    const map = parseIdpAudiences('fvks=meet,broken,=x,y=')
    expect(map.size).toBe(1)
    expect(map.get('fvks')).toBe('meet')
  })
})

describe('extrasOfAccessToken', () => {
  it('reads grant_id and subject from token body', () => {
    const extras = extrasOfAccessToken('opaque', {
      grant_id: 'g-1',
      subject: { id: 'u-1', type: 'user' },
    })
    expect(extras.grantId).toBe('g-1')
    expect(extras.subject).toEqual({ id: 'u-1', type: 'user' })
  })

  it('falls back to JWT claims when body omits extras', () => {
    const payload = Buffer.from(
      JSON.stringify({ sub: 'u-9', sub_type: 'user', grant_id: 'g-9' }),
      'utf8'
    ).toString('base64url')
    const jwt = `hdr.${payload}.sig`
    const extras = extrasOfAccessToken(jwt, {})
    expect(extras.grantId).toBe('g-9')
    expect(extras.subject).toEqual({ id: 'u-9', type: 'user' })
  })
})

describe('parseTokenSubject', () => {
  it('defaults unknown type to user', () => {
    expect(parseTokenSubject({ id: 'a', type: 'bot' })).toEqual({ id: 'a', type: 'user' })
  })
})
