import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/core/config/env'
import {
  type AppAssertion,
  type AppKey,
  AppAssertionError,
  parseAppKeys,
  verifyAppAssertion,
} from '@/lib/fvks/agents-api/assertion'
import {
  AgentsApiIdentityError,
  type AgentsApiPrincipal,
  resolveAgentsApiPrincipal,
} from '@/lib/fvks/agents-api/identity'
import { claimAssertionJti } from '@/lib/fvks/agents-api/jti'
import { AgentsApiError } from '@/lib/fvks/agents-api/service'

const logger = createLogger('FvksAgentsApiAuth')

let cachedKeys: Map<string, AppKey> | null = null
let cachedRaw: string | undefined

function loadAppKeys(): Map<string, AppKey> {
  const raw = env.HUB_APP_KEYS
  if (cachedKeys && cachedRaw === raw) return cachedKeys
  cachedRaw = raw
  cachedKeys = parseAppKeys(raw)
  return cachedKeys
}

export interface AgentsApiAuthContext {
  assertion: AppAssertion
  principal: AgentsApiPrincipal
}

export function agentsApiErrorResponse(error: unknown): NextResponse {
  if (error instanceof AgentsApiError) {
    return NextResponse.json(
      { message: error.message, code: error.code ?? null },
      { status: error.status }
    )
  }
  if (error instanceof AgentsApiIdentityError) {
    return NextResponse.json(
      { message: error.message, code: error.code },
      { status: error.status }
    )
  }
  if (error instanceof AppAssertionError) {
    return NextResponse.json({ message: error.message }, { status: 401 })
  }
  if (error instanceof Error && error.message.startsWith('HUB_APP_KEYS')) {
    logger.error('HUB_APP_KEYS misconfigured', { error: error.message })
    return NextResponse.json({ message: 'agents are not configured' }, { status: 503 })
  }
  logger.error('Agents API unexpected error', {
    error: error instanceof Error ? error.message : String(error),
  })
  return NextResponse.json({ message: 'agents unavailable' }, { status: 503 })
}

/**
 * Verify Bearer assertion, claim jti, resolve Sim principal.
 */
export async function authenticateAgentsApiRequest(
  request: NextRequest
): Promise<AgentsApiAuthContext> {
  const keys = loadAppKeys()
  if (keys.size === 0) {
    throw new AgentsApiError('agents are not configured', 503)
  }

  const header = request.headers.get('authorization') ?? ''
  const [scheme, token] = header.split(' ')
  if (scheme !== 'Bearer' || !token) {
    throw new AppAssertionError('assertion required')
  }

  const assertion = await verifyAppAssertion(token, keys)
  if (!(await claimAssertionJti(assertion))) {
    throw new AppAssertionError('assertion already used')
  }

  const principal = await resolveAgentsApiPrincipal(assertion)
  return { assertion, principal }
}
