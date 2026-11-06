import { apiKey } from '@sim/db/schema'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@sim/db'
import { revokePersonalApiKeysTx } from '@/lib/organizations/members/revocation'

afterAll(resetDbChainMock)

beforeEach(() => {
  resetDbChainMock()
})

describe('revokePersonalApiKeysTx', () => {
  it('deletes only personal keys and reports how many were removed', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'pk-1' }, { id: 'pk-2' }])

    await expect(revokePersonalApiKeysTx(db, { userId: 'user-1' })).resolves.toEqual({
      revoked: 2,
    })

    expect(dbChainMockFns.delete).toHaveBeenCalledWith(apiKey)
    expect(dbChainMockFns.where).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'and',
        conditions: expect.arrayContaining([
          expect.objectContaining({ type: 'eq', right: 'user-1' }),
          expect.objectContaining({ type: 'eq', right: 'personal' }),
        ]),
      })
    )
  })
})
