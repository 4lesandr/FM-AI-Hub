/**
 * Public Agents API contract for series apps (FMAH ADR 0011 / docs/agents-api.md).
 * Shapes match `@fmah/agents-sdk` so FVKS meet panel stays wire-compatible.
 */

export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type ObjectContext = Record<string, string>

export interface AgentInfo {
  id: string
  name: string
  description: string
  link: 'auto' | 'tools'
  autoEvents: string[]
  start: 'run' | 'chat'
  paused: boolean
  trial: boolean
  available: boolean
  unavailable: 'not_connected' | 'not_ready' | 'needs_setup' | 'blocked' | null
  threadId: string | null
  fromCatalog?: boolean
  action?: string | null
  setupMessage?: string | null
  access?: { app: string } | null
}

export interface AccessLink {
  app: string | null
  url: string | null
}

export interface RunInfo {
  id: string
  agentId: string
  agentName: string
  status: RunStatus
  origin: 'event' | 'schedule' | 'manual'
  eventType: string | null
  task: string | null
  output: string | null
  error: string | null
  threadId: string | null
  trial: boolean
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface ToolCallInfo {
  id: string
  name: string
  effect: 'read' | 'write' | 'destructive'
  ok: boolean | null
  error: string | null
  trial: boolean
}

export interface ApprovalInfo {
  id: string
  toolName: string
  arguments: Record<string, unknown>
  expiresAt: string
}

export interface RunDetail extends RunInfo {
  toolCalls: ToolCallInfo[]
  approvals: ApprovalInfo[]
}

export interface Panel {
  connected: boolean
  agents: AgentInfo[]
  runs: RunInfo[]
}

export interface Thread {
  id: string
  agentId: string
  agentName: string
  runs: RunDetail[]
}

export interface ApiErrorBody {
  message: string
  code?: string
}
