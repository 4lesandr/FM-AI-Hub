ALTER TABLE "agent_release" ADD COLUMN "share_revoked_at" timestamp;--> statement-breakpoint
CREATE INDEX "agent_release_share_revoked_at_idx" ON "agent_release" USING btree ("share_revoked_at");
