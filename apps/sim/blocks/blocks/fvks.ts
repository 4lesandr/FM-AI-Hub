import { FvksIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import { getTrigger } from '@/triggers'

export const FvksBlock: BlockConfig = {
  type: 'fvks',
  name: 'FM Meetings',
  description: 'Trigger workflows from FM Meetings events',
  longDescription:
    'Listen for FM Meetings (FVKS) events such as recording.stopped or meeting.ended. FM Meetings posts directly to /api/webhooks/fvks/<token>; deployed workflows fan out by grant id. No FMAH in the path.',
  category: 'triggers',
  integrationType: IntegrationType.Communication,
  bgColor: '#1F4B99',
  icon: FvksIcon,
  triggerAllowed: true,
  docsLink: 'https://docs.sim.ai',

  canvasPresentation: {
    defaultTitle: 'FM Meetings',
    triggerSentences: {
      byTrigger: {
        fvks_recording_stopped: ['Run when a recording stops'],
        fvks_meeting_ended: ['Run when a meeting ends'],
        fvks_webhook: ['Run on any FM Meetings event'],
      },
    },
  },

  subBlocks: [...getTrigger('fvks_recording_stopped').subBlocks],

  tools: {
    access: [],
  },

  inputs: {},

  outputs: {
    event_type: { type: 'string', description: 'FVKS event type' },
    event_id: { type: 'string', description: 'FVKS event id' },
    grant_id: { type: 'string', description: 'OAuth grant id' },
    recording_id: { type: 'string', description: 'Recording id' },
    room_id: { type: 'string', description: 'Room id' },
    subject_id: { type: 'string', description: 'Subject user id' },
    payload: { type: 'json', description: 'Normalized event payload' },
  },

  triggers: {
    enabled: true,
    available: ['fvks_recording_stopped', 'fvks_meeting_ended', 'fvks_webhook'],
  },
}

export const FvksBlockMeta = {
  tags: ['meetings', 'fvks', 'fm'],
  templates: [],
}
