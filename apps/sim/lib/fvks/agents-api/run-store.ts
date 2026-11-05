import { generateId } from '@sim/utils/id'
import { getRedisClient } from '@/lib/core/config/redis'
import type { ObjectContext, RunInfo, RunStatus } from '@/lib/fvks/agents-api/types'

const TTL_SEC = 60 * 60 * 24 * 7
const memoryRuns = new Map<string, AgentsApiRunRecord>()
const memoryUserIndex = new Map<string, Set<string>>()

export interface AgentsApiRunRecord {
  id: string
  userId: string
  agentId: string
  agentName: string
  workflowId: string
  status: RunStatus
  origin: 'event' | 'schedule' | 'manual'
  eventType: string | null
  task: string | null
  output: string | null
  error: string | null
  threadId: string | null
  trial: boolean
  connector: string
  context: ObjectContext
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

function runKey(id: string): string {
  return `agents-api:run:${id}`
}

function userIndexKey(userId: string): string {
  return `agents-api:user-runs:${userId}`
}

function threadKey(threadId: string): string {
  return `agents-api:thread:${threadId}`
}

async function writeJson(key: string, value: unknown): Promise<void> {
  const redis = getRedisClient()
  const payload = JSON.stringify(value)
  if (redis) {
    await redis.set(key, payload, 'EX', TTL_SEC)
    return
  }
  if (key.startsWith('agents-api:run:')) {
    memoryRuns.set(key.slice('agents-api:run:'.length), value as AgentsApiRunRecord)
  }
}

async function readJson<T>(key: string): Promise<T | null> {
  const redis = getRedisClient()
  if (redis) {
    const raw = await redis.get(key)
    if (!raw) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }
  if (key.startsWith('agents-api:run:')) {
    return (memoryRuns.get(key.slice('agents-api:run:'.length)) as T | undefined) ?? null
  }
  return null
}

export function toRunInfo(record: AgentsApiRunRecord): RunInfo {
  return {
    id: record.id,
    agentId: record.agentId,
    agentName: record.agentName,
    status: record.status,
    origin: record.origin,
    eventType: record.eventType,
    task: record.task,
    output: record.output,
    error: record.error,
    threadId: record.threadId,
    trial: record.trial,
    createdAt: record.createdAt,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
  }
}

export async function saveAgentsApiRun(record: AgentsApiRunRecord): Promise<void> {
  await writeJson(runKey(record.id), record)
  const redis = getRedisClient()
  if (redis) {
    await redis.sadd(userIndexKey(record.userId), record.id)
    await redis.expire(userIndexKey(record.userId), TTL_SEC)
    if (record.threadId) {
      await redis.rpush(threadKey(record.threadId), record.id)
      await redis.expire(threadKey(record.threadId), TTL_SEC)
    }
    return
  }
  const set = memoryUserIndex.get(record.userId) ?? new Set<string>()
  set.add(record.id)
  memoryUserIndex.set(record.userId, set)
}

export async function getAgentsApiRun(id: string): Promise<AgentsApiRunRecord | null> {
  return readJson<AgentsApiRunRecord>(runKey(id))
}

export async function updateAgentsApiRun(
  id: string,
  patch: Partial<AgentsApiRunRecord>
): Promise<AgentsApiRunRecord | null> {
  const existing = await getAgentsApiRun(id)
  if (!existing) return null
  const next = { ...existing, ...patch, id: existing.id }
  await saveAgentsApiRun(next)
  return next
}

export async function listAgentsApiRunsForUser(
  userId: string,
  connector: string,
  context: ObjectContext,
  limit = 30
): Promise<AgentsApiRunRecord[]> {
  const redis = getRedisClient()
  let ids: string[] = []
  if (redis) {
    ids = await redis.smembers(userIndexKey(userId))
  } else {
    ids = [...(memoryUserIndex.get(userId) ?? [])]
  }

  const contextEntries = Object.entries(context).filter(([k]) => k !== 'connector')
  const records: AgentsApiRunRecord[] = []
  for (const id of ids) {
    const record = await getAgentsApiRun(id)
    if (!record || record.connector !== connector) continue
    if (contextEntries.length === 0) {
      records.push(record)
      continue
    }
    const matches = contextEntries.some(
      ([key, value]) => typeof record.context[key] === 'string' && record.context[key] === value
    )
    if (matches) records.push(record)
  }

  return records
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
}

export async function listAgentsApiThreadRunIds(threadId: string): Promise<string[]> {
  const redis = getRedisClient()
  if (redis) {
    return redis.lrange(threadKey(threadId), 0, -1)
  }
  return [...memoryRuns.values()]
    .filter((r) => r.threadId === threadId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((r) => r.id)
}

export function newThreadId(): string {
  return generateId()
}
