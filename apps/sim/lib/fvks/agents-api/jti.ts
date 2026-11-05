import { getRedisClient } from '@/lib/core/config/redis'
import type { AppAssertion } from '@/lib/fvks/agents-api/assertion'

const memory = new Map<string, number>()
const MEMORY_SWEEP_MS = 60_000
let lastSweep = 0

function memoryKey(app: string, jti: string): string {
  return `${app}:${jti}`
}

function sweepMemory(now = Date.now()): void {
  if (now - lastSweep < MEMORY_SWEEP_MS) return
  lastSweep = now
  for (const [key, expiresAt] of memory) {
    if (expiresAt <= now) memory.delete(key)
  }
}

/**
 * One-time assertion claim. Prefers Redis SET NX; falls back to process memory
 * when Redis is down (localdev).
 */
export async function claimAssertionJti(assertion: AppAssertion): Promise<boolean> {
  const key = `agents-api:jti:${assertion.app}:${assertion.jti}`
  const ttlSec = Math.max(
    1,
    Math.ceil((assertion.expiresAt.getTime() - Date.now()) / 1000)
  )
  const redis = getRedisClient()
  if (redis) {
    const result = await redis.set(key, '1', 'EX', ttlSec, 'NX')
    return result === 'OK'
  }

  sweepMemory()
  const mk = memoryKey(assertion.app, assertion.jti)
  if (memory.has(mk)) return false
  memory.set(mk, assertion.expiresAt.getTime())
  return true
}
