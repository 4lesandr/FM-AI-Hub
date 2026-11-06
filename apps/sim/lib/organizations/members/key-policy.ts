import { member } from '@sim/db/schema'
import { count, eq } from 'drizzle-orm'
import { env, envBoolean } from '@/lib/core/config/env'
import type { DbOrTx } from '@/lib/db/types'

/**
 * FLOMNI hub leave policy for personal API keys.
 *
 * Upstream SaaS keeps personal keys after an org leave (the person may still
 * belong elsewhere). Hub deploy sets `ORG_REVOKE_PERSONAL_KEYS_ON_LEAVE=true`
 * so leaving the sole org burns personal keys the way SCIM deprovision already
 * does. Multi-org safety: revoke only when zero memberships remain after the
 * delete, so a second org on the same instance is not collateral damage.
 */

/** Unset / false = upstream leave behavior; true = hub leave burns personal keys. */
export function isOrgRevokePersonalKeysOnLeaveEnabled(): boolean {
  return envBoolean(env.ORG_REVOKE_PERSONAL_KEYS_ON_LEAVE) === true
}

/**
 * Whether leave should delete the user's personal API keys.
 *
 * Call after the membership row for the departed org is gone, so
 * `remainingOrgMemberships` is the post-removal count.
 */
export function shouldRevokePersonalKeysOnLeave(params: {
  remainingOrgMemberships: number
}): boolean {
  if (!isOrgRevokePersonalKeysOnLeaveEnabled()) return false
  return params.remainingOrgMemberships === 0
}

/** Force (SCIM) or leave-policy decision after membership deletion. */
export function resolveRevokePersonalApiKeysOnLeave(params: {
  forceRevoke: boolean
  remainingOrgMemberships: number
}): boolean {
  return (
    params.forceRevoke ||
    shouldRevokePersonalKeysOnLeave({
      remainingOrgMemberships: params.remainingOrgMemberships,
    })
  )
}

export async function countRemainingOrgMemberships(
  database: DbOrTx,
  userId: string
): Promise<number> {
  const [row] = await database
    .select({ value: count() })
    .from(member)
    .where(eq(member.userId, userId))
  return Number(row?.value ?? 0)
}
