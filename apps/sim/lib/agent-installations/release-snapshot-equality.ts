import { canonicalJson } from '@/lib/api/cursor-binding'

/** Stable digest of a hardened AgentRelease `state` jsonb for Publish dedup. */
export function agentReleaseSnapshotDigest(state: unknown): string {
  return canonicalJson(state)
}

/** True when two stored/hardened release snapshots are semantically identical. */
export function areAgentReleaseSnapshotsEqual(left: unknown, right: unknown): boolean {
  return agentReleaseSnapshotDigest(left) === agentReleaseSnapshotDigest(right)
}
