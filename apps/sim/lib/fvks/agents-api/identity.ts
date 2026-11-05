import { db } from '@sim/db'
import { account, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, sql } from 'drizzle-orm'
import type { AppAssertion } from '@/lib/fvks/agents-api/assertion'
import { resolveOidcProviderId } from '@/lib/fvks/token-exchange'

export class AgentsApiIdentityError extends Error {
  constructor(
    message: string,
    readonly code: 'identity_unresolved' | 'account_not_linked' | 'principal_disabled',
    readonly status: number = 403
  ) {
    super(message)
    this.name = 'AgentsApiIdentityError'
  }
}

export interface AgentsApiPrincipal {
  userId: string
  email: string
  name: string
  idpSubject: string
}

/**
 * Resolve Keycloak `sub` → Sim user. First contact creates a linked OAuth user
 * (parity with FMAH AppIdentityService). Email collision without SSO link → account_not_linked.
 */
export async function resolveAgentsApiPrincipal(
  assertion: AppAssertion
): Promise<AgentsApiPrincipal> {
  const providerId = resolveOidcProviderId()

  const [owned] = await db
    .select({
      userId: account.userId,
      email: user.email,
      name: user.name,
      banned: user.banned,
      suspendedAt: user.suspendedAt,
    })
    .from(account)
    .innerJoin(user, eq(user.id, account.userId))
    .where(and(eq(account.accountId, assertion.sub), eq(account.providerId, providerId)))
    .limit(1)

  if (owned) {
    if (owned.banned || owned.suspendedAt) {
      throw new AgentsApiIdentityError('principal disabled', 'principal_disabled', 401)
    }
    return {
      userId: owned.userId,
      email: owned.email,
      name: owned.name,
      idpSubject: assertion.sub,
    }
  }

  // Also try literal keycloak if provider id was customized.
  if (providerId !== 'keycloak') {
    const [fallback] = await db
      .select({
        userId: account.userId,
        email: user.email,
        name: user.name,
        banned: user.banned,
        suspendedAt: user.suspendedAt,
      })
      .from(account)
      .innerJoin(user, eq(user.id, account.userId))
      .where(and(eq(account.accountId, assertion.sub), eq(account.providerId, 'keycloak')))
      .limit(1)
    if (fallback) {
      if (fallback.banned || fallback.suspendedAt) {
        throw new AgentsApiIdentityError('principal disabled', 'principal_disabled', 401)
      }
      return {
        userId: fallback.userId,
        email: fallback.email,
        name: fallback.name,
        idpSubject: assertion.sub,
      }
    }
  }

  if (!assertion.email) {
    throw new AgentsApiIdentityError('identity cannot be resolved', 'identity_unresolved')
  }

  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = ${assertion.email.toLowerCase()}`)
    .limit(1)

  if (existing) {
    throw new AgentsApiIdentityError('account is not linked', 'account_not_linked')
  }

  const userId = generateId()
  const now = new Date()
  const name = assertion.name ?? assertion.email
  await db.insert(user).values({
    id: userId,
    name,
    email: assertion.email,
    emailVerified: false,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(account).values({
    id: generateId(),
    accountId: assertion.sub,
    providerId,
    userId,
    createdAt: now,
    updatedAt: now,
  })

  return {
    userId,
    email: assertion.email,
    name,
    idpSubject: assertion.sub,
  }
}
