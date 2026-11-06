-- migration-safe: additive expand — new InstallationThread tables for /3g-chat C3 history
CREATE TYPE "public"."agent_installation_thread_message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
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
ALTER TABLE "agent_installation_thread" ADD CONSTRAINT "agent_installation_thread_installation_id_agent_installation_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."agent_installation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_installation_thread" ADD CONSTRAINT "agent_installation_thread_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_installation_thread_message" ADD CONSTRAINT "agent_installation_thread_message_thread_id_agent_installation_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."agent_installation_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_installation_thread_installation_unique" ON "agent_installation_thread" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "agent_installation_thread_user_id_idx" ON "agent_installation_thread" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_installation_thread_message_thread_created_at_idx" ON "agent_installation_thread_message" USING btree ("thread_id","created_at");
