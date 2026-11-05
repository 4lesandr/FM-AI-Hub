-- Expand: denormalized tenant on agent_release for Install-by-link reads.
-- Nullable so personal workspaces and the already-deployed writer stay valid.
ALTER TABLE "agent_release" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "agent_release" ADD CONSTRAINT "agent_release_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_release_organization_id_idx" ON "agent_release" USING btree ("organization_id");--> statement-breakpoint
-- Idempotent backfill from the author's workspace at the time of migration.
UPDATE "agent_release" AS ar
SET "organization_id" = w."organization_id"
FROM "workflow" AS wf
INNER JOIN "workspace" AS w ON w."id" = wf."workspace_id"
WHERE ar."workflow_id" = wf."id"
  AND ar."organization_id" IS NULL
  AND w."organization_id" IS NOT NULL;
