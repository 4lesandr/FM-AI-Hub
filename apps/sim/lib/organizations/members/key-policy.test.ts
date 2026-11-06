import { beforeEach, describe, expect, it } from 'vitest'
import { resetEnvMock, setEnv } from '@sim/testing/mocks/env.mock'
import {
  isOrgRevokePersonalKeysOnLeaveEnabled,
  resolveRevokePersonalApiKeysOnLeave,
  shouldRevokePersonalKeysOnLeave,
} from '@/lib/organizations/members/key-policy'

describe('org leave personal API key policy', () => {
  beforeEach(() => {
    resetEnvMock()
  })

  it('is off when the env flag is unset (upstream SaaS leave)', () => {
    setEnv({ ORG_REVOKE_PERSONAL_KEYS_ON_LEAVE: undefined })
    expect(isOrgRevokePersonalKeysOnLeaveEnabled()).toBe(false)
    expect(shouldRevokePersonalKeysOnLeave({ remainingOrgMemberships: 0 })).toBe(false)
  })

  it('revokes only when the flag is on and the user has no remaining orgs', () => {
    setEnv({ ORG_REVOKE_PERSONAL_KEYS_ON_LEAVE: 'true' })
    expect(shouldRevokePersonalKeysOnLeave({ remainingOrgMemberships: 0 })).toBe(true)
    expect(shouldRevokePersonalKeysOnLeave({ remainingOrgMemberships: 1 })).toBe(false)
  })

  it('keeps keys when the flag is explicitly off', () => {
    setEnv({ ORG_REVOKE_PERSONAL_KEYS_ON_LEAVE: 'false' })
    expect(shouldRevokePersonalKeysOnLeave({ remainingOrgMemberships: 0 })).toBe(false)
  })

  it('forces revoke for SCIM even when the leave flag is off', () => {
    setEnv({ ORG_REVOKE_PERSONAL_KEYS_ON_LEAVE: 'false' })
    expect(
      resolveRevokePersonalApiKeysOnLeave({ forceRevoke: true, remainingOrgMemberships: 1 })
    ).toBe(true)
  })

  it('applies leave policy when forceRevoke is false', () => {
    setEnv({ ORG_REVOKE_PERSONAL_KEYS_ON_LEAVE: 'true' })
    expect(
      resolveRevokePersonalApiKeysOnLeave({ forceRevoke: false, remainingOrgMemberships: 0 })
    ).toBe(true)
    expect(
      resolveRevokePersonalApiKeysOnLeave({ forceRevoke: false, remainingOrgMemberships: 2 })
    ).toBe(false)
  })
})
