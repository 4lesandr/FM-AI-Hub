import { z } from 'zod'
import { nonEmptyIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { workflowIdParamsSchema } from '@/lib/api/contracts/workflows'

/** C2: retain prompts (default App Store) or strip system prompts from the snapshot. */
export const agentReleasePromptTierSchema = z.enum(['retain', 'strip-system'])

export const publishAgentReleaseBodySchema = z
  .object({
    promptTier: agentReleasePromptTierSchema.optional(),
  })
  .optional()
  .default({})

export const publishAgentReleaseResponseSchema = z.object({
  releaseId: nonEmptyIdSchema,
  workflowId: nonEmptyIdSchema,
  /** Tenant stamp from the author's workspace (null = personal / non-org). */
  organizationId: nonEmptyIdSchema.nullable(),
  version: z.number().int().positive(),
  shareToken: z.string().min(1),
  shareUrl: z.string().url(),
  createdAt: z.string().datetime(),
  installationsMarkedPending: z.number().int().nonnegative(),
  /** Older release share tokens invalidated by this Publish. */
  sharesRevoked: z.number().int().nonnegative(),
  /** Effective C2 prompt policy applied to the stored snapshot. */
  promptTier: agentReleasePromptTierSchema,
})

export type PublishAgentReleaseResponse = z.output<typeof publishAgentReleaseResponseSchema>

/** Session POST: Publish workflow → AgentRelease + Install share link. */
export const publishAgentReleaseContract = defineRouteContract({
  method: 'POST',
  path: '/api/workflows/[id]/publish',
  params: workflowIdParamsSchema,
  body: publishAgentReleaseBodySchema,
  response: {
    mode: 'json',
    schema: publishAgentReleaseResponseSchema,
  },
})

export const revokeAgentReleaseShareResponseSchema = z.object({
  workflowId: nonEmptyIdSchema,
  sharesRevoked: z.number().int().positive(),
  revokedAt: z.string().datetime(),
})

export type RevokeAgentReleaseShareResponse = z.output<
  typeof revokeAgentReleaseShareResponseSchema
>

/**
 * Session POST: invalidate all active Install share tokens for the workflow.
 * Installations keep running; resolve/install by old tokens return not_found.
 */
export const revokeAgentReleaseShareContract = defineRouteContract({
  method: 'POST',
  path: '/api/workflows/[id]/revoke-share',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: revokeAgentReleaseShareResponseSchema,
  },
})
