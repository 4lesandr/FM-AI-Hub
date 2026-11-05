import { SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import {
  AUDIENCE,
  parseAppKeys,
  verifyAppAssertion,
} from '@/lib/fvks/agents-api/assertion'

const SECRET = 's'.repeat(48)

describe('parseAppKeys', () => {
  it('parses app:secret and app@connector:secret', () => {
    const keys = parseAppKeys(`fvks:${SECRET}, mock@fvks:${SECRET}`)
    expect(keys.get('fvks')?.connector).toBe('fvks')
    expect(keys.get('mock')?.connector).toBe('fvks')
  })

  it('rejects short secrets', () => {
    expect(() => parseAppKeys('fvks:tooshort')).toThrow(/shorter/)
  })
})

describe('verifyAppAssertion', () => {
  it('accepts a fresh HS256 assertion', async () => {
    const keys = parseAppKeys(`fvks:${SECRET}`)
    const now = Math.floor(Date.now() / 1000)
    const token = await new SignJWT({
      email: 'a@example.com',
      name: 'Anna',
      jti: 'jti-1',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('fvks')
      .setAudience(AUDIENCE)
      .setSubject('kc-sub-1')
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(new TextEncoder().encode(SECRET))

    const assertion = await verifyAppAssertion(token, keys)
    expect(assertion.sub).toBe('kc-sub-1')
    expect(assertion.email).toBe('a@example.com')
    expect(assertion.connector).toBe('fvks')
  })

  it('rejects wrong audience', async () => {
    const keys = parseAppKeys(`fvks:${SECRET}`)
    const now = Math.floor(Date.now() / 1000)
    const token = await new SignJWT({ jti: 'jti-2' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('fvks')
      .setAudience('other')
      .setSubject('kc-sub-1')
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(new TextEncoder().encode(SECRET))

    await expect(verifyAppAssertion(token, keys)).rejects.toThrow(/rejected|unknown/)
  })
})
