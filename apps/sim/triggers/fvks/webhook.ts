import { FvksIcon } from '@/components/icons'
import {
  buildFvksExtraFields,
  buildFvksOutputs,
  fvksSetupInstructions,
  fvksTriggerOptions,
} from '@/triggers/fvks/utils'
import { buildTriggerSubBlocks } from '@/triggers/subblocks'
import type { TriggerConfig } from '@/triggers/types'

export const fvksWebhookTrigger: TriggerConfig = {
  id: 'fvks_webhook',
  name: 'FVKS Webhook',
  provider: 'fvks',
  description: 'Trigger workflow on any FM Meetings (FVKS) event for your grant',
  version: '1.0.0',
  icon: FvksIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'fvks_webhook',
    triggerOptions: fvksTriggerOptions,
    setupInstructions: fvksSetupInstructions('all'),
    extraFields: buildFvksExtraFields('fvks_webhook'),
    webhookPlaceholder: 'Platform URL: /api/webhooks/fvks/<FVKS_EVENTS_TOKEN>',
  }),
  outputs: buildFvksOutputs(),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  },
}
