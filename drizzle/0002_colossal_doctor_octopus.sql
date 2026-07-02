CREATE TABLE "final_videos" (
	"project_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"video_url" text,
	"error_message" text,
	"queue_job_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "final_videos" ADD CONSTRAINT "final_videos_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;