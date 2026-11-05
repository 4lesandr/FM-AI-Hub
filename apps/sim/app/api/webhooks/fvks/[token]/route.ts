import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike, toRecord } from '@sim/utils/object'
import { type NextRequest, NextResponse } from 'next/server'
import { admissionRejectedResponse, tryAdmit } from '@/lib/core/admission/gate'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  assertContentLengthWithinLimit,
  isPayloadSizeLimitError,
  readStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { WEBHOOK_MAX_BODY_BYTES } from '@/lib/webhooks/constants'
import { dispatchResolvedWebhookTarget, findWebhooksByRoutingKey } from '@/lib/webhooks/processor'
import {
  extractFvksGrantId,
  verifyFvksEventsToken,
  verifyFvksSignature,
} from '@/lib/webhooks/providers/fvks'

const logger = createLogger('FvksWebhookIngress')
const BODY_LABEL = 'FVKS webhook body'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * FM Meetings (FVKS) events Callback URL: `{APP_URL}/api/webhooks/fvks/{FVKS_EVENTS_TOKEN}`.
 * Verifies the path token (and optional HMAC), then fans out by `grant_id` to
 * deployed FVKS workflow triggers — same pattern as TikTok / Slack shared ingress.
 * Events are accepted directly from FM Meetings; FMAH is not in the path.
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ token: string }> }) => {
    const ticket = tryAdmit()
    if (!ticket) return admissionRejectedResponse()

    const requestId = generateRequestId()
    const receivedAt = Date.now()

    try {
      const { token } = await context.params
      const tokenError = verifyFvksEventsToken(token, requestId)
      if (tokenError) return tokenError

      assertContentLengthWithinLimit(request.headers, WEBHOOK_MAX_BODY_BYTES, BODY_LABEL)
      const buffer = await readStreamToBufferWithLimit(request.body, {
        maxBytes: WEBHOOK_MAX_BODY_BYTES,
        label: BODY_LABEL,
      })
      const rawBody = new TextDecoder().decode(buffer)

      const signatureError = verifyFvksSignature(
        rawBody,
        request.headers.get('x-fvks-signature'),
        requestId
      )
      if (signatureError) return signatureError

      let parsedJson: unknown
      try {
        parsedJson = rawBody ? JSON.parse(rawBody) : {}
      } catch {
        logger.warn(`[${requestId}] FVKS webhook body is not valid JSON`)
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
      }

      if (!isRecordLike(parsedJson)) {
        return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 })
      }

      const body = toRecord(parsedJson)
      const grantId = extractFvksGrantId(body, request.headers.get('x-fvks-grant-id'))
      if (!grantId) {
        logger.warn(`[${requestId}] FVKS webhook missing grant_id`)
        return NextResponse.json({ error: 'grant_id is required' }, { status: 400 })
      }

      const webhooks = await findWebhooksByRoutingKey(grantId, requestId, 'fvks')
      let dispatched = 0
      let failed = 0
      for (const { webhook, workflow, triggerBlockDeployed } of webhooks) {
        const result = await dispatchResolvedWebhookTarget(webhook, workflow, body, request, {
          requestId,
          receivedAt,
          triggerBlockDeployed,
        })
        if (result.outcome === 'queued') dispatched += 1
        if (result.outcome === 'failed') failed += 1
      }

      logger.info(`[${requestId}] Processed FVKS webhook delivery`, {
        dispatched,
        failed,
        targetCount: webhooks.length,
        grantIdPrefix: grantId.slice(0, 12),
      })

      if (failed > 0) {
        return NextResponse.json({ error: 'Temporarily unable to accept webhook' }, { status: 503 })
      }

      return new NextResponse(null, { status: 204 })
    } catch (error) {
      if (isPayloadSizeLimitError(error)) {
        return NextResponse.json({ error: 'Request body too large' }, { status: 413 })
      }
      logger.error(`[${requestId}] FVKS webhook failed`, { error: getErrorMessage(error) })
      return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
  }
)
