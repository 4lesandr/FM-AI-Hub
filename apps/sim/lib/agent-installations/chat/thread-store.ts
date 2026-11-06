import {
  agentInstallationThread,
  agentInstallationThreadMessage,
  type AgentInstallationThreadMessageRole,
  db,
} from '@sim/db'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, asc, eq } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const logger = createLogger('InstallationChat.ThreadStore')

export interface InstallationThreadRecord {
  id: string
  installationId: string
  userId: string
  createdAt: Date
  updatedAt: Date
}

export interface InstallationThreadMessageRecord {
  id: string
  threadId: string
  role: AgentInstallationThreadMessageRole
  content: string
  createdAt: Date
}

/**
 * MVP: one active thread per Installation. Creates on first chat open/send.
 */
export async function getOrCreateInstallationThread(input: {
  installationId: string
  userId: string
}): Promise<InstallationThreadRecord> {
  const [existing] = await db
    .select({
      id: agentInstallationThread.id,
      installationId: agentInstallationThread.installationId,
      userId: agentInstallationThread.userId,
      createdAt: agentInstallationThread.createdAt,
      updatedAt: agentInstallationThread.updatedAt,
    })
    .from(agentInstallationThread)
    .where(eq(agentInstallationThread.installationId, input.installationId))
    .limit(1)

  if (existing) {
    if (existing.userId !== input.userId) {
      throw new OrchestrationError('forbidden', 'Installation thread belongs to another user')
    }
    return existing
  }

  const now = new Date()
  const id = generateId()
  const [created] = await db
    .insert(agentInstallationThread)
    .values({
      id,
      installationId: input.installationId,
      userId: input.userId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({
      id: agentInstallationThread.id,
      installationId: agentInstallationThread.installationId,
      userId: agentInstallationThread.userId,
      createdAt: agentInstallationThread.createdAt,
      updatedAt: agentInstallationThread.updatedAt,
    })

  if (created) {
    logger.info('Created InstallationThread', {
      threadId: created.id,
      installationId: created.installationId,
    })
    return created
  }

  // Race: another request inserted first.
  const [raced] = await db
    .select({
      id: agentInstallationThread.id,
      installationId: agentInstallationThread.installationId,
      userId: agentInstallationThread.userId,
      createdAt: agentInstallationThread.createdAt,
      updatedAt: agentInstallationThread.updatedAt,
    })
    .from(agentInstallationThread)
    .where(eq(agentInstallationThread.installationId, input.installationId))
    .limit(1)

  if (!raced || raced.userId !== input.userId) {
    throw new OrchestrationError('internal', 'Failed to open Installation thread')
  }
  return raced
}

export async function listInstallationThreadMessages(
  threadId: string
): Promise<InstallationThreadMessageRecord[]> {
  return db
    .select({
      id: agentInstallationThreadMessage.id,
      threadId: agentInstallationThreadMessage.threadId,
      role: agentInstallationThreadMessage.role,
      content: agentInstallationThreadMessage.content,
      createdAt: agentInstallationThreadMessage.createdAt,
    })
    .from(agentInstallationThreadMessage)
    .where(eq(agentInstallationThreadMessage.threadId, threadId))
    .orderBy(asc(agentInstallationThreadMessage.createdAt))
}

export async function appendInstallationThreadMessage(input: {
  threadId: string
  role: AgentInstallationThreadMessageRole
  content: string
  id?: string
}): Promise<InstallationThreadMessageRecord> {
  const id = input.id ?? generateId()
  const now = new Date()
  const [row] = await db
    .insert(agentInstallationThreadMessage)
    .values({
      id,
      threadId: input.threadId,
      role: input.role,
      content: input.content,
      createdAt: now,
    })
    .returning({
      id: agentInstallationThreadMessage.id,
      threadId: agentInstallationThreadMessage.threadId,
      role: agentInstallationThreadMessage.role,
      content: agentInstallationThreadMessage.content,
      createdAt: agentInstallationThreadMessage.createdAt,
    })

  await db
    .update(agentInstallationThread)
    .set({ updatedAt: now })
    .where(eq(agentInstallationThread.id, input.threadId))

  if (!row) {
    throw new OrchestrationError('internal', 'Failed to persist chat message')
  }
  return row
}

/** Ensure thread belongs to installer (defense in depth for message reads). */
export async function assertThreadOwnedByUser(threadId: string, userId: string): Promise<void> {
  const [row] = await db
    .select({ id: agentInstallationThread.id })
    .from(agentInstallationThread)
    .where(
      and(eq(agentInstallationThread.id, threadId), eq(agentInstallationThread.userId, userId))
    )
    .limit(1)
  if (!row) {
    throw new OrchestrationError('not_found', 'Installation thread not found')
  }
}
