import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { ProductBrief, ShowPlan } from "~/types/showrunner";
import { SHOWRUNNER_JOB_STATUSES } from "~/types/showrunner-status";
import { VIDEO_GENERATION_STATUSES } from "~/types/video-status";

export const videoGenerationStatusEnum = pgEnum(
  "video_generation_status",
  VIDEO_GENERATION_STATUSES,
);

export const showrunnerJobStatusEnum = pgEnum(
  "showrunner_job_status",
  SHOWRUNNER_JOB_STATUSES,
);

export const subscriptionPlanEnum = pgEnum("subscription_plan", [
  "free",
  "pro",
  "studio",
]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "paused",
  "canceled",
  "expired",
]);

export const usageEventTypeEnum = pgEnum("usage_event_type", [
  "showrunner_generation",
  "scene_render",
  "final_stitch",
]);

// Auth.js's DrizzleAdapter creates users without passing an id, so the
// schema itself must generate one (unlike `projects.id`, which the app sets).
export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    // @auth/drizzle-adapter's Postgres schema type requires these OAuth
    // token fields to use snake_case JS property names (matching Auth.js's
    // `Account` type), not just snake_case DB column names.
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
    index("accounts_user_id_idx").on(table.userId),
  ],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("manual"),
    providerCustomerId: text("provider_customer_id"),
    providerSubscriptionId: text("provider_subscription_id"),
    plan: subscriptionPlanEnum("plan").notNull(),
    status: subscriptionStatusEnum("status").notNull(),
    currentPeriodStart: timestamp("current_period_start", {
      withTimezone: true,
    }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("subscriptions_user_id_idx").on(table.userId),
    uniqueIndex("subscriptions_provider_subscription_id_idx").on(
      table.providerSubscriptionId,
    ),
  ],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventType: usageEventTypeEnum("event_type").notNull(),
    units: integer("units").notNull().default(1),
    sourceId: text("source_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("usage_events_user_id_created_at_idx").on(
      table.userId,
      table.createdAt,
    ),
    index("usage_events_user_type_created_at_idx").on(
      table.userId,
      table.eventType,
      table.createdAt,
    ),
  ],
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    showPlan: jsonb("show_plan").$type<ShowPlan>().notNull(),
  },
  (table) => [index("projects_user_id_idx").on(table.userId)],
);

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
    status: videoGenerationStatusEnum("status").notNull(),
    prompt: text("prompt").notNull(),
    voiceOver: text("voice_over"),
    useProductReference: boolean("use_product_reference").notNull().default(false),
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

export const showrunnerJobs = pgTable(
  "showrunner_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    briefJson: jsonb("brief_json").$type<ProductBrief>().notNull(),
    status: showrunnerJobStatusEnum("status").notNull(),
    errorMessage: text("error_message"),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("showrunner_jobs_user_id_idx").on(table.userId)],
);

export const finalVideos = pgTable("final_videos", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  status: videoGenerationStatusEnum("status").notNull(),
  videoUrl: text("video_url"),
  errorMessage: text("error_message"),
  queueJobId: text("queue_job_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
