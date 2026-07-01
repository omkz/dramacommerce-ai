CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"show_plan" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_jobs" (
	"project_id" text NOT NULL,
	"scene" integer NOT NULL,
	"provider" text DEFAULT 'wan' NOT NULL,
	"queue_job_id" text,
	"task_id" text,
	"status" text NOT NULL,
	"prompt" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"video_url" text,
	"error_message" text,
	"last_polled_at" timestamp with time zone,
	"next_poll_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "video_jobs_project_id_scene_pk" PRIMARY KEY("project_id","scene")
);
--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_jobs_status_idx" ON "video_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "video_jobs_next_poll_at_idx" ON "video_jobs" USING btree ("next_poll_at");