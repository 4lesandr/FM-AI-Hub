import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

export const FVKS_TRIGGER_TO_EVENT_TYPE: Record<string, string> = {
  fvks_recording_stopped: 'recording.stopped',
  fvks_meeting_ended: 'meeting.ended',
  fvks_webhook: '',
}

export const fvksTriggerOptions = [
  { label: 'Recording Stopped', id: 'fvks_recording_stopped' },
  { label: 'Meeting Ended', id: 'fvks_meeting_ended' },
  { label: 'Webhook (All Events)', id: 'fvks_webhook' },
]

export function fvksSetupInstructions(eventType: string): string {
  const eventLine =
    eventType === 'all'
      ? 'This trigger listens for <strong>all</strong> FM Meetings events for the grant below.'
      : `This trigger listens for <strong>${eventType}</strong> events for the grant below.`

  const instructions = [
    'Ask a Sim operator to set <code>FVKS_EVENTS_TOKEN</code> (and optionally <code>FVKS_EVENTS_SIGNING_SECRET</code>) on this deployment. Operator cutover: <code>docs/deploy/fvks-events-url-cutover.md</code>.',
    'In <strong>FM Meetings</strong>, set the events Callback URL to <code>{APP_URL}/api/webhooks/fvks/&lt;FVKS_EVENTS_TOKEN&gt;</code> (secret <code>FVKS_MCP_HUB_EVENTS_URL</code> or MCP client events URL — not <code>AGENT_HUB_URL</code>).',
    'Connect FVKS in the hub (<code>POST /api/fvks/connect</code>). Leave Grant ID empty to use that connection, or paste a specific <code>grant_id</code>.',
    eventLine,
    'Save the trigger, then deploy the workflow. Events fan out by grant id, not by a per-workflow path.',
  ]
  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

export function buildFvksExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'grantId',
      title: 'FVKS Grant ID',
      type: 'short-input',
      placeholder: 'auto from /api/fvks/connect',
      description:
        'Optional. OAuth grant id used as the webhook routing key. Empty = use your stored FVKS connection.',
      required: false,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

export function buildFvksOutputs(): Record<string, TriggerOutput> {
  return {
    event_type: { type: 'string', description: 'FVKS event type' },
    event_id: { type: 'string', description: 'FVKS event id' },
    grant_id: { type: 'string', description: 'OAuth grant id' },
    recording_id: { type: 'string', description: 'Recording id when present' },
    room_id: { type: 'string', description: 'Room id when present' },
    subject_id: { type: 'string', description: 'Subject user id' },
    payload: { type: 'json', description: 'Normalized event payload' },
  }
}
