# As-is Sim API — куда цеплять Publish / Install

Цель to-be: **Publish → share link → Install → Run(Identity=installer) → Update accept/defer**. Ниже — существующие поверхности Sim и куда вешать новые сущности, без fork/catalog.

## Карта «есть → gap → hook»

| To-be шаг | As-is ближайший аналог | Gap | Куда цеплять |
| --- | --- | --- | --- |
| **Publish** → `AgentRelease` (снимок без секретов) | `POST /api/workflows/[id]/deploy` → `deployWorkflow` → `workflow_deployment_version` (+ v2 `POST /api/v2/workflows/[workflowId]/deploy`) | Deploy = активация **того же** workflow у автора, не иммутабельное **издание** для чужих инсталляций; нет share-token канала | Рядом с `deployWorkflow` / `performFullDeploy`: отдельный use-case **publishRelease** → новая таблица `agent_release` (или флаги на version + `share_token`). Санитизация: уже есть `sanitizeWorkflowForSharing` в `lib/workflows/credentials/extractor` (см. `read-workflow-version.ts`) |
| **Share link** (token) | Invite token: `GET /api/workspaces/invitations`, `GET/POST /api/invitations/[id]`, accept `…/accept`; chat `identifier` → `/chat/[identifier]` | Invite = membership; chat identifier = публичный вход в **один** deployed chat автора | Новый resolve: `GET /api/agent-releases/by-token/[token]` (паттерн invite-by-token + chat identifier). UI: одна страница «Поставить себе», не fork |
| **Install** → `Installation` | `POST /api/workspaces/[id]/fork` (+ sync/promote/unlink); credentials: `/api/v2/credentials*` + `authorizeCredentialUseForAuth` | Fork копирует workspace **без** App Store update-канала; нет экземпляра «установлено мной» с pending updates | **Не** строить на fork. Новый `POST /api/agent-installations` → строка Installation (userId, releaseId/pinnedVersion, updatePolicy). При install — bind credentials installer’а (reuse credential members / OAuth consent UX) |
| **Run** Identity = User | Deployed chat/API бегут в контексте **workflow owner / workspace**; principal session/api-key на trigger | Часто identity автора или workspace billing, не installer | Runtime path execute: атрибуция/`credentialId` только из Installation.installer; запрет подставлять credentials автора из release snapshot (snapshot уже redacted) |
| **Update** accept/defer | Redeploy автора переключает `workflow_deployment_version.is_active`; fork sync/promote | Нет per-installation pending/accepted/deferred | На Publish N+1: пометить Installation `updatePolicy=pending`. API: `GET …/updates`, `POST …/accept`, `POST …/defer`. Accept → pin новой AgentRelease |
| **Revoke** Installation | Undeploy `DELETE …/deploy`; chat archive; fork unlink | Undeploy гасит издание у автора; unlink рвёт lineage | `DELETE /api/agent-installations/[id]` — только экземпляр user; release у других жив |

## Опорные файлы (as-is)

- Deploy UI/API: `apps/sim/app/api/workflows/[id]/deploy/route.ts`, `…/v2/workflows/[workflowId]/deploy/route.ts`, `lib/workflows/application/deployments.ts`
- Версии: `packages/db/schema.ts` → `workflowDeploymentVersion`, `workflowDeploymentOperation`
- Chat deploy ≠ Install: `apps/sim/app/api/chat/route.ts` → `deployWorkflowChat`; публичный вход `chat/[identifier]`
- Fork ≠ Install: `apps/sim/app/api/workspaces/[id]/fork/**`, `ee/workspace-forking/**`
- Invite token UX: `apps/sim/app/api/invitations/[id]/**`, `workspaces/invitations`
- Redaction для Publish: `sanitizeWorkflowForSharing` / `read-workflow-version.ts`
- Credentials installer: `apps/sim/app/api/v2/credentials/**`, `lib/auth` credential-access

## Явно не переиспользовать как основу Install

1. **Workspace fork** — копия + sync, нет accept/defer per user installation.
2. **Deployed chat** — один shared endpoint автора, не свой экземпляр.
3. **Workspace invite** — только паттерн token→accept UX, не membership в workspace автора.
