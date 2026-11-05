ALTER TABLE "agent_installation" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "agent_installation" ADD COLUMN "credential_bindings" json DEFAULT '{}'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_installation" ADD CONSTRAINT "agent_installation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_installation_workspace_id_idx" ON "agent_installation" USING btree ("workspace_id");
