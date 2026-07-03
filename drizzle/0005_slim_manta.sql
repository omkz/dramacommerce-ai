CREATE TYPE "public"."showrunner_job_status" AS ENUM('QUEUED', 'STORY', 'DIRECTING', 'PROMPTING', 'EDITING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TABLE "showrunner_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"brief_json" jsonb NOT NULL,
	"status" "showrunner_job_status" NOT NULL,
	"error_message" text,
	"project_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "showrunner_jobs" ADD CONSTRAINT "showrunner_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showrunner_jobs" ADD CONSTRAINT "showrunner_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "showrunner_jobs_user_id_idx" ON "showrunner_jobs" USING btree ("user_id");