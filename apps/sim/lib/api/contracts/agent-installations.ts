import { z } from 'zod'
import { nonEmptyIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const agentCredentialSlotSchema = z.object({
  key: z.string().min(1),
  blockId: nonEmptyIdSchema,
  blockName: z.string(),
  field: z.string().min(1),
  serviceId: z.string().nullable(),
  required: z.boolean(),
})

export const agentInstallationSummarySchema = z.object({
  id: nonEmptyIdSchema,
  updatePolicy: z.enum(['pending', 'accepted', 'deferred', 'current']),
  workspaceId: nonEmptyIdSchema.nullable(),
  /** Release the Installation is currently pinned to (may lag the share-token release). */
  pinnedReleaseId: nonEmptyIdSchema,
  pinnedVersion: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

/** Safe release meta for the Install page — never includes author secrets or raw state. */
export const resolveAgentReleaseByTokenResponseSchema = z.object({
  releaseId: nonEmptyIdSchema,
  workflowId: nonEmptyIdSchema,
  workflowName: z.string(),
  workflowDescription: z.string().nullable(),
  version: z.number().int().positive(),
  shareToken: z.string().min(1),
  createdAt: z.string().datetime(),
  credentialSlots: z.array(agentCredentialSlotSchema),
  installation: agentInstallationSummarySchema.nullable(),
})

export type ResolveAgentReleaseByTokenResponse = z.output<
  typeof resolveAgentReleaseByTokenResponseSchema
>

export const resolveAgentReleaseByTokenContract = defineRouteContract({
  method: 'GET',
  path: '/api/agent-releases/by-token/[token]',
  params: z.object({ token: z.string().min(1) }),
  response: {
    mode: 'json',
    schema: resolveAgentReleaseByTokenResponseSchema,
  },
})

export const installAgentReleaseBodySchema = z.object({
  shareToken: z.string().min(1),
  /** Installer's workspace that scopes credential authorization. */
  workspaceId: nonEmptyIdSchema,
  /**
   * Slot key (`blockId:field`) → credential id owned/usable by the installer.
   * Empty object is valid when the release has no credential slots.
   */
  credentialBindings: z.record(z.string().min(1), nonEmptyIdSchema).default({}),
})

export const installAgentReleaseResponseSchema = z.object({
  installationId: nonEmptyIdSchema,
  releaseId: nonEmptyIdSchema,
  workflowId: nonEmptyIdSchema,
  version: z.number().int().positive(),
  userId: nonEmptyIdSchema,
  workspaceId: nonEmptyIdSchema,
  updatePolicy: z.enum(['pending', 'accepted', 'deferred', 'current']),
  credentialBindings: z.record(z.string().min(1), nonEmptyIdSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  /** True when an active installation for this user+release already existed. */
  alreadyInstalled: z.boolean(),
})

export type InstallAgentReleaseResponse = z.output<typeof installAgentReleaseResponseSchema>

/** Session POST: Install AgentRelease by share token; Identity = installer. */
export const installAgentReleaseContract = defineRouteContract({
  method: 'POST',
  path: '/api/agent-installations',
  body: installAgentReleaseBodySchema,
  response: {
    mode: 'json',
    schema: installAgentReleaseResponseSchema,
  },
})

export const agentInstallationUpdatePolicySchema = z.enum([
  'pending',
  'accepted',
  'deferred',
  'current',
])

export const pendingAgentInstallationUpdateSchema = z.object({
  installationId: nonEmptyIdSchema,
  workflowId: nonEmptyIdSchema,
  workflowName: z.string(),
  workspaceId: nonEmptyIdSchema.nullable(),
  pinnedReleaseId: nonEmptyIdSchema,
  pinnedVersion: z.number().int().positive(),
  latestReleaseId: nonEmptyIdSchema,
  latestVersion: z.number().int().positive(),
  updatePolicy: agentInstallationUpdatePolicySchema,
  updatedAt: z.string().datetime(),
})

export const listPendingAgentInstallationUpdatesResponseSchema = z.object({
  updates: z.array(pendingAgentInstallationUpdateSchema),
})

export type ListPendingAgentInstallationUpdatesResponse = z.output<
  typeof listPendingAgentInstallationUpdatesResponseSchema
>

/** Session GET: installations with updatePolicy=pending for the caller. */
export const listPendingAgentInstallationUpdatesContract = defineRouteContract({
  method: 'GET',
  path: '/api/agent-installations/updates',
  response: {
    mode: 'json',
    schema: listPendingAgentInstallationUpdatesResponseSchema,
  },
})

export const agentInstallationIdParamsSchema = z.object({
  id: nonEmptyIdSchema,
})

export const acceptAgentInstallationUpdateResponseSchema = z.object({
  installationId: nonEmptyIdSchema,
  workflowId: nonEmptyIdSchema,
  previousReleaseId: nonEmptyIdSchema,
  previousVersion: z.number().int().positive(),
  releaseId: nonEmptyIdSchema,
  version: z.number().int().positive(),
  updatePolicy: agentInstallationUpdatePolicySchema,
  workspaceId: nonEmptyIdSchema.nullable(),
  credentialBindings: z.record(z.string().min(1), nonEmptyIdSchema),
  updatedAt: z.string().datetime(),
  /** True when the installer already had an active pin on the latest release. */
  consolidated: z.boolean(),
})

export type AcceptAgentInstallationUpdateResponse = z.output<
  typeof acceptAgentInstallationUpdateResponseSchema
>

/** Session POST: Accept pending update → repin Installation to latest AgentRelease. */
export const acceptAgentInstallationUpdateContract = defineRouteContract({
  method: 'POST',
  path: '/api/agent-installations/[id]/accept',
  params: agentInstallationIdParamsSchema,
  response: {
    mode: 'json',
    schema: acceptAgentInstallationUpdateResponseSchema,
  },
})

export const deferAgentInstallationUpdateResponseSchema = z.object({
  installationId: nonEmptyIdSchema,
  workflowId: nonEmptyIdSchema,
  releaseId: nonEmptyIdSchema,
  version: z.number().int().positive(),
  updatePolicy: z.literal('deferred'),
  workspaceId: nonEmptyIdSchema.nullable(),
  updatedAt: z.string().datetime(),
})

export type DeferAgentInstallationUpdateResponse = z.output<
  typeof deferAgentInstallationUpdateResponseSchema
>

/** Session POST: Defer pending update — stay pinned; updatePolicy=deferred. */
export const deferAgentInstallationUpdateContract = defineRouteContract({
  method: 'POST',
  path: '/api/agent-installations/[id]/defer',
  params: agentInstallationIdParamsSchema,
  response: {
    mode: 'json',
    schema: deferAgentInstallationUpdateResponseSchema,
  },
})

export const executeAgentInstallationBodySchema = z
  .object({
    input: z.unknown().optional(),
    triggerBlockId: nonEmptyIdSchema.optional(),
  })
  .optional()
  .default({})

export const executeAgentInstallationResponseSchema = z.object({
  installationId: nonEmptyIdSchema,
  releaseId: nonEmptyIdSchema,
  workflowId: nonEmptyIdSchema,
  version: z.number().int().positive(),
  /** Installer (Installation.userId) — not AgentRelease owner. */
  userId: nonEmptyIdSchema,
  workspaceId: nonEmptyIdSchema,
  executionId: nonEmptyIdSchema,
  status: z.enum(['completed', 'failed', 'paused', 'cancelled']),
  output: z.unknown().optional(),
  error: z.unknown().nullable().optional(),
})

export type ExecuteAgentInstallationResponse = z.output<
  typeof executeAgentInstallationResponseSchema
>

/** Session POST: run pinned release under installer identity + credentialBindings. */
export const executeAgentInstallationContract = defineRouteContract({
  method: 'POST',
  path: '/api/agent-installations/[id]/execute',
  params: agentInstallationIdParamsSchema,
  body: executeAgentInstallationBodySchema,
  response: {
    mode: 'json',
    schema: executeAgentInstallationResponseSchema,
  },
})

export const revokeAgentInstallationResponseSchema = z.object({
  installationId: nonEmptyIdSchema,
  releaseId: nonEmptyIdSchema,
  workflowId: nonEmptyIdSchema,
  version: z.number().int().positive(),
  revokedAt: z.string().datetime(),
  /** Always true: revoke never deletes or mutates AgentRelease. */
  releaseIntact: z.literal(true),
})

export type RevokeAgentInstallationResponse = z.output<typeof revokeAgentInstallationResponseSchema>

/**
 * Session DELETE: soft-revoke caller's Installation (revokedAt).
 * AgentRelease and other users' installations are untouched.
 */
export const revokeAgentInstallationContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/agent-installations/[id]',
  params: agentInstallationIdParamsSchema,
  response: {
    mode: 'json',
    schema: revokeAgentInstallationResponseSchema,
  },
})
