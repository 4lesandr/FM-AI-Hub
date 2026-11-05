import { decodeJwt, jwtVerify } from 'jose'

/**
 * Series-app assertion (FMAH ADR 0011). Meet signs a short JWT with the shared
 * secret; Hub verifies and never sees the browser.
 *
 * HUB_APP_KEYS: `app:secret` comma-separated; `app@connector:secret` when slugs differ.
 */

export const AUDIENCE = 'fmah-agents'
const MAX_AGE_SEC = 120
const CLOCK_TOLERANCE_SEC = 10
const MIN_SECRET_LENGTH = 32
const MAX_JTI_LENGTH = 100

export interface AppKey {
  app: string
  connector: string
  secret: Uint8Array
}

export interface AppAssertion {
  app: string
  connector: string
  sub: string
  email: string | null
  name: string | null
  jti: string
  expiresAt: Date
}

export class AppAssertionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppAssertionError'
  }
}

export function parseAppKeys(raw: string | undefined): Map<string, AppKey> {
  const keys = new Map<string, AppKey>()
  for (const item of (raw ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)) {
    const at = item.indexOf(':')
    const head = at > 0 ? item.slice(0, at) : ''
    const [app, connector] = head.split('@')
    const secret = at > 0 ? item.slice(at + 1) : ''
    if (
      !app ||
      !/^[a-z0-9-]+$/.test(app) ||
      (connector !== undefined && connector !== '' && !/^[a-z0-9-]+$/.test(connector))
    ) {
      throw new Error(
        'HUB_APP_KEYS: expected «app:secret» or «app@connector:secret», comma-separated'
      )
    }
    if (secret.length < MIN_SECRET_LENGTH) {
      throw new Error(`HUB_APP_KEYS: secret for ${app} shorter than ${MIN_SECRET_LENGTH}`)
    }
    if (keys.has(app)) throw new Error(`HUB_APP_KEYS: app ${app} listed twice`)
    keys.set(app, {
      app,
      connector: connector && connector.length > 0 ? connector : app,
      secret: new TextEncoder().encode(secret),
    })
  }
  return keys
}

export async function verifyAppAssertion(
  token: string,
  keys: Map<string, AppKey>,
  now = new Date()
): Promise<AppAssertion> {
  let issuer: string | undefined
  try {
    issuer = decodeJwt(token).iss
  } catch {
    throw new AppAssertionError('malformed assertion')
  }
  const key = issuer ? keys.get(issuer) : undefined
  if (!key) throw new AppAssertionError('unknown application')
  try {
    const { payload } = await jwtVerify(token, key.secret, {
      algorithms: ['HS256'],
      issuer: key.app,
      audience: AUDIENCE,
      maxTokenAge: MAX_AGE_SEC,
      clockTolerance: CLOCK_TOLERANCE_SEC,
      requiredClaims: ['sub', 'iat', 'exp', 'jti'],
      currentDate: now,
    })
    const text = (value: unknown) =>
      typeof value === 'string' && value.trim() ? value.trim() : null
    if (!payload.jti || payload.jti.length > MAX_JTI_LENGTH) {
      throw new AppAssertionError('assertion rejected')
    }
    return {
      app: key.app,
      connector: key.connector,
      sub: payload.sub!,
      email: text(payload.email)?.toLowerCase() ?? null,
      name: text(payload.name),
      jti: payload.jti,
      expiresAt: new Date((payload.exp! + CLOCK_TOLERANCE_SEC) * 1000),
    }
  } catch (error) {
    if (error instanceof AppAssertionError) throw error
    throw new AppAssertionError('assertion rejected')
  }
}
