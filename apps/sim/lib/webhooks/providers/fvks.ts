import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Hex } from '@sim/security/hmac'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike, toRecord } from '@sim/utils/object'
import { NextResponse } from 'next/server'
import { env } from '@/lib/core/config/env'
import { WebhookDeploymentConfigurationError } from '@/lib/webhooks/providers/errors'
import type {
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { FVKS_TRIGGER_TO_EVENT_TYPE } from '@/triggers/fvks/utils'

const logger = createLogger('WebhookProvider:Fvks')

/** FVKS recommends rejecting replayed signatures; 5 minutes matches TikTok/Linear practice. */
export const FVKS_WEBHOOK_TIMESTAMP_SKEW_SECONDS = 5 * 60

export interface FvksSignatureParts {
  timestamp: string
  signature: string
}

/**
 * Parse `x-fvks-signature: t=<unix>,v1=<hex>`.
 */
export function parseFvksSignatureHeader(header: string | null): FvksSignatureParts | null {
  if (!header) return null
  const match = /^t=(\d+),v1=([0-9a-fA-F]+)$/.exec(header.trim())
  if (!match) return null
  return { timestamp: match[1], signature: match[2] }
}

/**
 * Verify FM Meetings (FVKS) HMAC-SHA256 of `${t}.${rawBody}` with the platform signing secret.
 * Returns null on success, or a 401 NextResponse on failure.
 * When no signing secret is configured, verification is skipped (local stands).
 */
export function verifyFvksSignature(
  rawBody: string,
  signatureHeader: string | null,
  requestId: string,
  signingSecret: string | undefined = env.FVKS_EVENTS_SIGNING_SECRET,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): NextResponse | null {
  if (!signingSecret) {
    return null
  }

  const parts = parseFvksSignatureHeader(signatureHeader)
  if (!parts) {
    logger.warn(`[${requestId}] FVKS webhook missing or malformed x-fvks-signature`)
    return new NextResponse('Unauthorized - Missing FVKS signature', { status: 401 })
  }

  const timestampSeconds = Number(parts.timestamp)
  if (!Number.isFinite(timestampSeconds)) {
    logger.warn(`[${requestId}] FVKS webhook signature timestamp is not a number`)
    return new NextResponse('Unauthorized - Invalid FVKS signature timestamp', { status: 401 })
  }

  if (Math.abs(nowSeconds - timestampSeconds) > FVKS_WEBHOOK_TIMESTAMP_SKEW_SECONDS) {
    logger.warn(`[${requestId}] FVKS webhook signature timestamp outside allowed skew`, {
      skewSeconds: FVKS_WEBHOOK_TIMESTAMP_SKEW_SECONDS,
      timestampSeconds,
      nowSeconds,
    })
    return new NextResponse('Unauthorized - FVKS signature timestamp skew too large', {
      status: 401,
    })
  }

  const computed = hmacSha256Hex(`${parts.timestamp}.${rawBody}`, signingSecret)
  if (!safeCompare(computed, parts.signature)) {
    logger.warn(`[${requestId}] FVKS signature verification failed`)
    return new NextResponse('Unauthorized - Invalid FVKS signature', { status: 401 })
  }

  return null
}

/**
 * Compare the path token against the platform FVKS events token.
 */
export function verifyFvksEventsToken(
  token: string,
  requestId: string,
  configuredToken: string | undefined = env.FVKS_EVENTS_TOKEN
): NextResponse | null {
  if (!configuredToken) {
    logger.warn(`[${requestId}] FVKS webhook missing FVKS_EVENTS_TOKEN`)
    return new NextResponse('Unauthorized - FVKS events token not configured', { status: 401 })
  }
  if (!token || !safeCompare(token, configuredToken)) {
    logger.warn(`[${requestId}] FVKS webhook path token mismatch`)
    return new NextResponse(null, { status: 404 })
  }
  return null
}

function stringField(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

/**
 * Extract `grant_id` from the event body or `x-fvks-grant-id` header.
 */
export function extractFvksGrantId(
  body: Record<string, unknown>,
  grantHeader: string | null
): string | null {
  const fromBody = stringField(body, 'grant_id')
  const fromHeader = grantHeader?.trim() || null
  if (fromBody && fromHeader && fromBody !== fromHeader) {
    return null
  }
  return fromBody ?? fromHeader
}

/**
 * FM Meetings (FVKS) webhook handler. Ingress is `/api/webhooks/fvks/[token]`;
 * deployments route by `grant_id` (same pattern as TikTok `user_openid`).
 * Empty grantId resolves from the deployer's stored FVKS connection (`/2c`).
 */
export const fvksHandler: WebhookProviderHandler = {
  ingressMode: 'provider',
  executionMode: 'queue',

  async prepareDeploymentConfig({ providerConfig, userId, requestId }) {
    let grantId = typeof providerConfig.grantId === 'string' ? providerConfig.grantId.trim() : ''
    if (!grantId && userId) {
      const { loadFvksStoredTokens } = await import('@/lib/fvks/connection-store')
      const stored = await loadFvksStoredTokens(userId)
      const fromConnection = stored?.grant_id?.trim()
      if (fromConnection) {
        grantId = fromConnection
        logger.info(`[${requestId}] FVKS grantId resolved from stored connection`)
      }
    }
    if (!grantId) {
      throw new WebhookDeploymentConfigurationError(
        'Connect FVKS (POST /api/fvks/connect) or enter the grant id so events can be routed to the workflow.'
      )
    }

    return {
      providerConfigUpdates: {
        grantId,
      },
      triggerPath: null,
      routingKey: grantId,
    }
  },

  matchEvent({ body, providerConfig, requestId }: EventMatchContext): boolean {
    const triggerId = providerConfig.triggerId as string | undefined
    if (!triggerId || triggerId === 'fvks_webhook') return true
    const expected = FVKS_TRIGGER_TO_EVENT_TYPE[triggerId]
    if (!expected) {
      logger.debug(`[${requestId}] Unknown FVKS triggerId ${triggerId}, skipping`)
      return false
    }
    const payload = isRecordLike(body) ? body : {}
    const event = toRecord(payload.event)
    const actual = stringField(event, 'type') || stringField(payload, 'event_type')
    if (actual !== expected) {
      logger.debug(`[${requestId}] FVKS event type mismatch: expected ${expected}, got ${actual}`)
      return false
    }
    return true
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    try {
      const payload = isRecordLike(body) ? body : {}
      const event = toRecord(payload.event)
      const subject = toRecord(payload.subject)
      return {
        input: {
          event_type: stringField(event, 'type') ?? stringField(payload, 'event_type'),
          event_id: stringField(event, 'id') ?? stringField(payload, 'event_id'),
          grant_id: stringField(payload, 'grant_id'),
          recording_id: stringField(event, 'recording_id'),
          room_id: stringField(event, 'room_id'),
          subject_id: stringField(subject, 'id'),
          payload: event,
        },
      }
    } catch (error) {
      logger.error('Failed to format FVKS webhook input', { error: getErrorMessage(error) })
      return { input: { payload: body } }
    }
  },
}
