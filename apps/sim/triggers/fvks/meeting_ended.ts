import { FvksIcon } from '@/components/icons'
import {
  buildFvksExtraFields,
  buildFvksOutputs,
  fvksSetupInstructions,
  fvksTriggerOptions,
} from '@/triggers/fvks/utils'
import { buildTriggerSubBlocks } from '@/triggers/subblocks'
import type { TriggerConfig } from '@/triggers/types'

export const fvksMeetingEndedTrigger: TriggerConfig = {
  id: 'fvks_meeting_ended',
  name: 'FVKS Meeting Ended',
  provider: 'fvks',
  description: 'Trigger workflow when an FVKS meeting ends',
  version: '1.0.0',
  icon: FvksIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'fvks_meeting_ended',
    triggerOptions: fvksTriggerOptions,
    setupInstructions: fvksSetupInstructions('meeting.ended'),
    extraFields: buildFvksExtraFields('fvks_meeting_ended'),
    webhookPlaceholder: 'Platform URL: /api/webhooks/fvks/<FVKS_EVENTS_TOKEN>',
  }),
  outputs: buildFvksOutputs(),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  },
}
