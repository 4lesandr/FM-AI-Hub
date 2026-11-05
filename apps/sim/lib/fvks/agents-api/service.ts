import { db } from '@sim/db'
import { chat, webhook, workflow, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId, isValidUuid } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import { decodeJwt } from 'jose'
import { generateRequestId } from '@/lib/core/utils/request'
import { cancelWorkflowExecution } from '@/lib/execution/cancel-workflow-execution'
import {
  connectFvksForUser,
  FvksConnectError,
  getFvksConnectionStatus,
} from '@/lib/fvks/auto-connect'
import type { AppAssertion } from '@/lib/fvks/agents-api/assertion'
import type { AgentsApiPrincipal } from '@/lib/fvks/agents-api/identity'
import {
  type AgentsApiRunRecord,
  getAgentsApiRun,
  listAgentsApiRunsForUser,
  listAgentsApiThreadRunIds,
  newThreadId,
  saveAgentsApiRun,
  toRunInfo,
  updateAgentsApiRun,
} from '@/lib/fvks/agents-api/run-store'
import type {
  AccessLink,
  AgentInfo,
  ObjectContext,
  Panel,
  RunDetail,
  RunInfo,
  RunStatus,
  Thread,
} from '@/lib/fvks/agents-api/types'
import { materializeExecutionDataForDisplay } from '@/lib/logs/execution/trace-store'
import { executeWorkflowService } from '@/lib/workflows/executor/execute-service'

const logger = createLogger('FvksAgentsApi')
const MAX_MESSAGE_LENGTH = 8000
const CONTEXT_KEYS = new Set(['room_id', 'recording_id'])

export class AgentsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message)
    this.name = 'AgentsApiError'
  }
}

function sanitizeContext(
  raw: unknown,
  connector: string
): ObjectContext {
  const out: ObjectContext = { connector }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!CONTEXT_KEYS.has(key)) continue
    if (typeof value === 'string' && value.length > 0 && value.length <= 200) {
      out[key] = value
    }
  }
  return out
}

function mapLogStatus(status: string | null | undefined): RunStatus {
  switch (status) {
    case 'pending':
    case 'queued':
      return 'queued'
    case 'running':
    case 'redacting':
      return 'running'
    case 'paused':
      return 'waiting_approval'
    case 'cancelled':
      return 'cancelled'
    case 'failed':
    case 'error':
      return 'failed'
    case 'completed':
    case 'success':
      return 'succeeded'
    default:
      return status === 'info' ? 'running' : 'running'
  }
}

function stringifyOutput(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.content === 'string') return record.content
    if (typeof record.text === 'string') return record.text
    if (typeof record.output === 'string') return record.output
    try {
      return JSON.stringify(value)
    } catch {
      return null
    }
  }
  return String(value)
}

async function listFvksWorkflowAgents(
  userId: string,
  connected: boolean
): Promise<AgentInfo[]> {
  const rows = await db
    .select({
      workflowId: workflow.id,
      name: workflow.name,
      description: workflow.description,
      isDeployed: workflow.isDeployed,
      providerConfig: webhook.providerConfig,
    })
    .from(webhook)
    .innerJoin(workflow, eq(workflow.id, webhook.workflowId))
    .where(
      and(
        eq(webhook.provider, 'fvks'),
        eq(webhook.isActive, true),
        isNull(webhook.archivedAt),
        eq(workflow.userId, userId),
        isNull(workflow.archivedAt)
      )
    )

  const seen = new Set<string>()
  const agents: AgentInfo[] = []
  for (const row of rows) {
    if (seen.has(row.workflowId)) continue
    seen.add(row.workflowId)
    if (!isValidUuid(row.workflowId)) continue

    const cfg =
      row.providerConfig && typeof row.providerConfig === 'object'
        ? (row.providerConfig as Record<string, unknown>)
        : {}
    const triggerId = typeof cfg.triggerId === 'string' ? cfg.triggerId : 'fvks_webhook'
    const autoEvents =
      triggerId === 'fvks_webhook'
        ? ['*']
        : triggerId === 'fvks_recording_stopped'
          ? ['recording.stopped']
          : triggerId === 'fvks_meeting_ended'
            ? ['meeting.ended']
            : [triggerId]

    const unavailable: AgentInfo['unavailable'] = !connected
      ? 'not_connected'
      : !row.isDeployed
        ? 'not_ready'
        : null

    agents.push({
      id: row.workflowId,
      name: row.name,
      description: row.description ?? '',
      link: 'auto',
      autoEvents,
      start: 'chat',
      paused: false,
      trial: false,
      available: unavailable === null,
      unavailable,
      threadId: null,
      action: null,
      access: null,
    })
  }
  return agents
}

async function listChatAgents(userId: string, connected: boolean): Promise<AgentInfo[]> {
  const rows = await db
    .select({
      id: chat.id,
      title: chat.title,
      description: chat.description,
      workflowId: chat.workflowId,
      isActive: chat.isActive,
    })
    .from(chat)
    .where(and(eq(chat.userId, userId), isNull(chat.archivedAt), eq(chat.isActive, true)))
    .limit(50)

  return rows
    .filter((row) => isValidUuid(row.id))
    .map((row) => {
      const unavailable: AgentInfo['unavailable'] = !connected
        ? 'not_connected'
        : !row.isActive
          ? 'not_ready'
          : null
      return {
        id: row.id,
        name: row.title,
        description: row.description ?? '',
        link: 'tools' as const,
        autoEvents: [] as string[],
        start: 'chat' as const,
        paused: false,
        trial: false,
        available: unavailable === null,
        unavailable,
        threadId: null,
        action: null,
        access: null,
      }
    })
}

async function resolveAgentWorkflow(
  userId: string,
  agentId: string
): Promise<{ workflowId: string; agentName: string } | null> {
  const [wf] = await db
    .select({ id: workflow.id, name: workflow.name })
    .from(workflow)
    .where(and(eq(workflow.id, agentId), eq(workflow.userId, userId), isNull(workflow.archivedAt)))
    .limit(1)
  if (wf) return { workflowId: wf.id, agentName: wf.name }

  const [ch] = await db
    .select({
      id: chat.id,
      title: chat.title,
      workflowId: chat.workflowId,
    })
    .from(chat)
    .where(and(eq(chat.id, agentId), eq(chat.userId, userId), isNull(chat.archivedAt)))
    .limit(1)
  if (ch) return { workflowId: ch.workflowId, agentName: ch.title }
  return null
}

async function refreshRunFromExecutionLog(
  record: AgentsApiRunRecord
): Promise<AgentsApiRunRecord> {
  const [log] = await db
    .select({
      status: workflowExecutionLogs.status,
      startedAt: workflowExecutionLogs.startedAt,
      endedAt: workflowExecutionLogs.endedAt,
      executionData: workflowExecutionLogs.executionData,
      workflowId: workflowExecutionLogs.workflowId,
      workspaceId: workflowExecutionLogs.workspaceId,
    })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.executionId, record.id))
    .limit(1)

  if (!log) return record

  let output = record.output
  let error = record.error
  try {
    const data = await materializeExecutionDataForDisplay(
      log.executionData as Record<string, unknown>,
      {
        workspaceId: log.workspaceId,
        workflowId: log.workflowId,
        executionId: record.id,
        userId: record.userId,
      }
    )
    output = stringifyOutput(data?.finalOutput) ?? output
    if (typeof data?.error === 'string') error = data.error
  } catch (err) {
    logger.warn('Failed to materialize agents-api run output', {
      executionId: record.id,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  const status = mapLogStatus(log.status)
  const patched = await updateAgentsApiRun(record.id, {
    status,
    output,
    error: status === 'failed' ? error || 'run failed' : error,
    startedAt: log.startedAt?.toISOString() ?? record.startedAt,
    finishedAt: log.endedAt?.toISOString() ?? (status === 'succeeded' || status === 'failed' || status === 'cancelled'
      ? new Date().toISOString()
      : record.finishedAt),
  })
  return patched ?? record
}

export async function buildPanel(
  principal: AgentsApiPrincipal,
  assertion: AppAssertion,
  query: Record<string, unknown>
): Promise<Panel> {
  const connection = await getFvksConnectionStatus(principal.userId)
  const connected = connection.connected
  const context = sanitizeContext(query, assertion.connector)

  const [fvksAgents, chatAgents, runs] = await Promise.all([
    listFvksWorkflowAgents(principal.userId, connected),
    listChatAgents(principal.userId, connected),
    listAgentsApiRunsForUser(principal.userId, assertion.connector, context),
  ])

  const byId = new Map<string, AgentInfo>()
  for (const agent of [...fvksAgents, ...chatAgents]) {
    if (!byId.has(agent.id)) byId.set(agent.id, agent)
  }

  const agents = [...byId.values()]
  for (const agent of agents) {
    const latest = runs.find((r) => r.agentId === agent.id && r.threadId)
    if (latest?.threadId) agent.threadId = latest.threadId
  }

  return {
    connected,
    agents,
    runs: runs.map(toRunInfo),
  }
}

export async function connectFromApp(
  principal: AgentsApiPrincipal,
  body: unknown
): Promise<{ connected: boolean }> {
  const token = (body as { subject_token?: unknown } | null)?.subject_token
  if (typeof token !== 'string' || !token || token.length > 16_000) {
    throw new AgentsApiError('subject_token is required', 400)
  }
  try {
    const claims = decodeJwt(token)
    if (claims.sub && claims.sub !== principal.idpSubject) {
      throw new AgentsApiError('token is about another person', 403, 'identity_mismatch')
    }
  } catch (error) {
    if (error instanceof AgentsApiError) throw error
    // opaque tokens: skip claim check; exchange will fail if invalid
  }

  try {
    const connection = await connectFvksForUser({
      userId: principal.userId,
      subjectToken: token,
    })
    return { connected: connection.connected }
  } catch (error) {
    if (error instanceof FvksConnectError) {
      throw new AgentsApiError(error.message, error.status)
    }
    throw error
  }
}

export async function accessLink(): Promise<AccessLink> {
  // Sim has no FMAH consent cascade yet; panel uses connect for FVKS grant.
  return { app: null, url: null }
}

export async function sendMessage(
  principal: AgentsApiPrincipal,
  assertion: AppAssertion,
  agentId: string,
  body: unknown
): Promise<RunInfo> {
  if (!isValidUuid(agentId)) throw new AgentsApiError('agent not found', 404)

  const payload = (body ?? {}) as {
    text?: unknown
    threadId?: unknown
    context?: unknown
  }
  if (typeof payload.text !== 'string' || !payload.text.trim()) {
    throw new AgentsApiError('text is required', 400)
  }
  if (payload.text.length > MAX_MESSAGE_LENGTH) {
    throw new AgentsApiError(`text is longer than ${MAX_MESSAGE_LENGTH} characters`, 400)
  }
  if (
    payload.threadId !== undefined &&
    payload.threadId !== null &&
    typeof payload.threadId !== 'string'
  ) {
    throw new AgentsApiError('threadId must be a string', 400)
  }

  const connection = await getFvksConnectionStatus(principal.userId)
  if (!connection.connected) {
    throw new AgentsApiError('agent is not available', 400, 'not_connected')
  }

  const agent = await resolveAgentWorkflow(principal.userId, agentId)
  if (!agent) throw new AgentsApiError('agent not found', 404)

  const threadId =
    typeof payload.threadId === 'string' && payload.threadId
      ? payload.threadId
      : newThreadId()
  if (payload.threadId && !isValidUuid(threadId)) {
    throw new AgentsApiError('thread not found', 404)
  }

  const context = sanitizeContext(payload.context, assertion.connector)
  const requestId = generateRequestId()
  const executionId = generateId()

  const result = await executeWorkflowService({
    workflowId: agent.workflowId,
    principal: {
      kind: 'session',
      userId: principal.userId,
      sessionId: `agents-api:${principal.userId}`,
    },
    userId: principal.userId,
    input: {
      input: payload.text,
      text: payload.text,
      context,
      threadId,
      source: 'fvks-agents-api',
    },
    triggerType: 'api',
    requestId,
    executionId,
    useAuthenticatedUserAsActor: true,
    mode: 'async',
  })

  if (!('ok' in result) || !result.ok) {
    const failure = result as { message?: string; statusCode?: number; code?: string }
    throw new AgentsApiError(
      failure.message || 'failed to start run',
      failure.statusCode ?? 500,
      failure.code
    )
  }

  const now = new Date().toISOString()
  const record: AgentsApiRunRecord = {
    id: result.executionId,
    userId: principal.userId,
    agentId,
    agentName: agent.agentName,
    workflowId: agent.workflowId,
    status: 'queued',
    origin: 'manual',
    eventType: null,
    task: payload.text,
    output: null,
    error: null,
    threadId,
    trial: false,
    connector: assertion.connector,
    context,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
  }
  await saveAgentsApiRun(record)
  return toRunInfo(record)
}

export async function getRun(
  principal: AgentsApiPrincipal,
  assertion: AppAssertion,
  runId: string
): Promise<RunDetail> {
  if (!isValidUuid(runId)) throw new AgentsApiError('run not found', 404)
  const record = await getAgentsApiRun(runId)
  if (!record || record.userId !== principal.userId || record.connector !== assertion.connector) {
    throw new AgentsApiError('run not found', 404)
  }
  const refreshed = await refreshRunFromExecutionLog(record)
  return { ...toRunInfo(refreshed), toolCalls: [], approvals: [] }
}

export async function getThread(
  principal: AgentsApiPrincipal,
  assertion: AppAssertion,
  threadId: string
): Promise<Thread> {
  if (!isValidUuid(threadId)) throw new AgentsApiError('thread not found', 404)
  const runIds = await listAgentsApiThreadRunIds(threadId)
  const runs: RunDetail[] = []
  let agentId = ''
  let agentName = ''
  for (const id of runIds) {
    const record = await getAgentsApiRun(id)
    if (!record || record.userId !== principal.userId || record.connector !== assertion.connector) {
      continue
    }
    const refreshed = await refreshRunFromExecutionLog(record)
    agentId = refreshed.agentId
    agentName = refreshed.agentName
    runs.push({ ...toRunInfo(refreshed), toolCalls: [], approvals: [] })
  }
  if (!runs.length) throw new AgentsApiError('thread not found', 404)
  return { id: threadId, agentId, agentName, runs }
}

export async function cancelRun(
  principal: AgentsApiPrincipal,
  assertion: AppAssertion,
  runId: string
): Promise<RunInfo> {
  const detail = await getRun(principal, assertion, runId)
  const record = await getAgentsApiRun(runId)
  if (!record) throw new AgentsApiError('run not found', 404)

  try {
    const [log] = await db
      .select({ workspaceId: workflowExecutionLogs.workspaceId })
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, runId))
      .limit(1)
    if (log) {
      await cancelWorkflowExecution({
        executionId: runId,
        workflowId: record.workflowId,
        attributedUserId: principal.userId,
        workspaceId: log.workspaceId,
      })
    }
  } catch (error) {
    logger.warn('Agents API cancel best-effort failed', {
      runId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const updated =
    (await updateAgentsApiRun(runId, {
      status: 'cancelled',
      finishedAt: new Date().toISOString(),
    })) ?? record
  return toRunInfo(updated)
}

export async function decideApproval(): Promise<void> {
  throw new AgentsApiError('approval not found', 404)
}

export async function assertRunInScope(
  principal: AgentsApiPrincipal,
  assertion: AppAssertion,
  runId: string
): Promise<AgentsApiRunRecord> {
  if (!isValidUuid(runId)) throw new AgentsApiError('run not found', 404)
  const record = await getAgentsApiRun(runId)
  if (!record || record.userId !== principal.userId || record.connector !== assertion.connector) {
    throw new AgentsApiError('run not found', 404)
  }
  return record
}

export { refreshRunFromExecutionLog }
