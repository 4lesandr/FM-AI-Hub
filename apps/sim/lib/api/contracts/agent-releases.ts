import { z } from 'zod'
import { nonEmptyIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { workflowIdParamsSchema } from '@/lib/api/contracts/workflows'

export const publishAgentReleaseResponseSchema = z.object({
  releaseId: nonEmptyIdSchema,
  workflowId: nonEmptyIdSchema,
  version: z.number().int().positive(),
  shareToken: z.string().min(1),
  shareUrl: z.string().url(),
  createdAt: z.string().datetime(),
  installationsMarkedPending: z.number().int().nonnegative(),
})

export type PublishAgentReleaseResponse = z.output<typeof publishAgentReleaseResponseSchema>

/** Session POST: Publish workflow → AgentRelease + Install share link. */
export const publishAgentReleaseContract = defineRouteContract({
  method: 'POST',
  path: '/api/workflows/[id]/publish',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: publishAgentReleaseResponseSchema,
  },
})
