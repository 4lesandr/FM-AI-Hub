export {
  connectFvksForUser,
  FvksConnectError,
  getFvksConnectionStatus,
  isFvksAutoConnectConfigured,
  loadSsoAccessToken,
} from '@/lib/fvks/auto-connect'
export {
  clearFvksStoredTokens,
  findUserIdByFvksGrantId,
  getAccessTokenForMcp,
  getFvksConnectionPublic,
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
