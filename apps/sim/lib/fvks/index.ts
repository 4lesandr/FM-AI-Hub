export {
  AUDIENCE as AGENTS_API_AUDIENCE,
  authenticateAgentsApiRequest,
  parseAppKeys,
  verifyAppAssertion,
} from '@/lib/fvks/agents-api'
export {
  connectFvksForUser,
  FvksConnectError,
  getFvksConnectionStatus,
  isFvksAutoConnectConfigured,
  loadSsoAccessToken,
} from '@/lib/fvks/auto-connect'
export type { FvksCatchUpUserResult, FvksListEventsPage } from '@/lib/fvks/catch-up'
export {
  catchUpFvksEventsAll,
  catchUpFvksEventsForUser,
  parseFvksListEventsResult,
} from '@/lib/fvks/catch-up'
export {
  advanceFvksEventsCursor,
  clearFvksStoredTokens,
  findUserIdByFvksGrantId,
  getAccessTokenForMcp,
  getFvksConnectionPublic,
  isCursorAhead,
  listFvksConnectedUserIds,
  loadFvksStoredTokens,
  saveFvksStoredTokens,
} from '@/lib/fvks/connection-store'
export { getFvksMcpAuthHeaders, probeFvksMcpWithStoredGrant } from '@/lib/fvks/mcp-access'
export {
  exchangeAndMintFvksTokens,
  exchangeSubjectToken,
  extrasOfAccessToken,
  FVKS_CONNECTION_ENV_KEY,
  JWT_BEARER_GRANT,
  mintFvksTokensWithAssertion,
  parseIdpAudiences,
  resolveFvksTokenEndpoint,
  resolveOidcIssuer,
  resolveOidcProviderId,
  TOKEN_EXCHANGE_GRANT,
} from '@/lib/fvks/token-exchange'
export type {
  FvksAcquiredVia,
  FvksConnectionPublic,
  FvksStoredTokens,
  FvksTokenExtras,
  FvksTokenSubject,
} from '@/lib/fvks/types'
