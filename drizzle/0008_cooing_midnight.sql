CREATE TYPE "public"."outbox_event_status" AS ENUM('PENDING', 'DELIVERED', 'FAILED');--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" text PRIMARY KEY NOT NULL,
	"queue" text NOT NULL,
	"job_name" text NOT NULL,
	"job_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbox_event_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "final_videos" ADD COLUMN "stitch_generation_id" text;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "generation_id" text;--> statement-breakpoint
UPDATE "video_jobs" SET "generation_id" = gen_random_uuid()::text WHERE "generation_id" IS NULL;--> statement-breakpoint
ALTER TABLE "video_jobs" ALTER COLUMN "generation_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_events_job_key_idx" ON "outbox_events" USING btree ("job_key");--> statement-breakpoint
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events" USING btree ("status","available_at");