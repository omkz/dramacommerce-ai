ALTER TYPE "public"."showrunner_job_status" ADD VALUE 'ANALYZING' BEFORE 'STORY';--> statement-breakpoint
ALTER TYPE "public"."showrunner_job_status" ADD VALUE 'CRITIQUING' BEFORE 'EDITING';--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "use_product_reference" boolean DEFAULT false NOT NULL;