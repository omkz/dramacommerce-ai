import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { ShowPlan } from "~/types/showrunner";

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  showPlan: jsonb("show_plan").$type<ShowPlan>().notNull(),
});

export const videoJobs = pgTable(
  "video_jobs",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    scene: integer("scene").notNull(),
    provider: text("provider").notNull().default("wan"),
    queueJobId: text("queue_job_id"),
    taskId: text("task_id"),
    status: text("status").notNull(),
    prompt: text("prompt").notNull(),
    attempts: integer("attempts").notNull().default(0),
    videoUrl: text("video_url"),
    errorMessage: text("error_message"),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    nextPollAt: timestamp("next_poll_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.scene] }),
    index("video_jobs_status_idx").on(table.status),
    index("video_jobs_next_poll_at_idx").on(table.nextPollAt),
  ],
);
