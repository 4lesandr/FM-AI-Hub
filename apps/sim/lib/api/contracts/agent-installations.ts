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
