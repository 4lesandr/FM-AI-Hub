CREATE TYPE "public"."agent_installation_update_policy" AS ENUM('pending', 'accepted', 'deferred', 'current');--> statement-breakpoint
CREATE TYPE "public"."agent_installation_thread_message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TABLE "agent_release" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"version" integer NOT NULL,
	"state" json NOT NULL,
	"share_token" text NOT NULL,
	"share_revoked_at" timestamp,
	"organization_id" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_installation" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"release_id" text NOT NULL,
	"workspace_id" text,
	"credential_bindings" json DEFAULT '{}'::json NOT NULL,
	"update_policy" "agent_installation_update_policy" DEFAULT 'current' NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_installation_thread" (
	"id" text PRIMARY KEY NOT NULL,
	"installation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_installation_thread_message" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"role" "agent_installation_thread_message_role" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_release" ADD CONSTRAINT "agent_release_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_release" ADD CONSTRAINT "agent_release_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_release" ADD CONSTRAINT "agent_release_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_installation" ADD CONSTRAINT "agent_installation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_installation" ADD CONSTRAINT "agent_installation_release_id_agent_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."agent_release"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_installation" ADD CONSTRAINT "agent_installation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_installation_thread" ADD CONSTRAINT "agent_installation_thread_installation_id_agent_installation_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."agent_installation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_installation_thread" ADD CONSTRAINT "agent_installation_thread_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_installation_thread_message" ADD CONSTRAINT "agent_installation_thread_message_thread_id_agent_installation_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."agent_installation_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_release_workflow_version_unique" ON "agent_release" USING btree ("workflow_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_release_share_token_unique" ON "agent_release" USING btree ("share_token");--> statement-breakpoint
CREATE INDEX "agent_release_workflow_id_idx" ON "agent_release" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "agent_release_created_by_idx" ON "agent_release" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "agent_release_share_revoked_at_idx" ON "agent_release" USING btree ("share_revoked_at");--> statement-breakpoint
CREATE INDEX "agent_release_organization_id_idx" ON "agent_release" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_installation_user_release_active_unique" ON "agent_installation" USING btree ("user_id","release_id") WHERE "revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "agent_installation_user_id_idx" ON "agent_installation" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_installation_release_id_idx" ON "agent_installation" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "agent_installation_update_policy_idx" ON "agent_installation" USING btree ("update_policy");--> statement-breakpoint
CREATE INDEX "agent_installation_workspace_id_idx" ON "agent_installation" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_installation_thread_installation_unique" ON "agent_installation_thread" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "agent_installation_thread_user_id_idx" ON "agent_installation_thread" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_installation_thread_message_thread_created_at_idx" ON "agent_installation_thread_message" USING btree ("thread_id","created_at");--> statement-breakpoint
-- Idempotent backfill: denormalized tenant on agent_release from author workspace.
UPDATE "agent_release" AS ar
SET "organization_id" = w."organization_id"
FROM "workflow" AS wf
INNER JOIN "workspace" AS w ON w."id" = wf."workspace_id"
WHERE ar."workflow_id" = wf."id"
  AND ar."organization_id" IS NULL
  AND w."organization_id" IS NOT NULL;
