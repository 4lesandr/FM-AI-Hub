import { FvksIcon } from '@/components/icons'
import {
  buildFvksExtraFields,
  buildFvksOutputs,
  fvksSetupInstructions,
  fvksTriggerOptions,
} from '@/triggers/fvks/utils'
import { buildTriggerSubBlocks } from '@/triggers/subblocks'
import type { TriggerConfig } from '@/triggers/types'

export const fvksRecordingStoppedTrigger: TriggerConfig = {
  id: 'fvks_recording_stopped',
  name: 'FVKS Recording Stopped',
  provider: 'fvks',
  description: 'Trigger workflow when an FVKS recording stops',
  version: '1.0.0',
  icon: FvksIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'fvks_recording_stopped',
    triggerOptions: fvksTriggerOptions,
    includeDropdown: true,
    setupInstructions: fvksSetupInstructions('recording.stopped'),
    extraFields: buildFvksExtraFields('fvks_recording_stopped'),
    webhookPlaceholder: 'Platform URL: /api/webhooks/fvks/<FVKS_EVENTS_TOKEN>',
  }),
  outputs: buildFvksOutputs(),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  },
}
