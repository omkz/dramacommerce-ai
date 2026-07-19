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

export const outboxEventStatusEnum = pgEnum("outbox_event_status", [
  "PENDING",
  "DELIVERED",
  "FAILED",
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
    // Minted fresh server-side each time a *new* generation is started
    // (initial render or explicit regenerate) — lets the worker detect and
    // ignore a stale queued/poll job that arrived after the scene was
    // regenerated again. See services/project-store.server.ts and
    // scripts/video-worker.mjs.
    generationId: text("generation_id").notNull(),
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
  // Same purpose as video_jobs.generation_id, one level up — lets the
  // stitch worker detect and ignore a stale stitch job superseded by a
  // newer re-stitch request. Nullable because rows created before this
  // column existed have no meaningful value (and are always terminal).
  stitchGenerationId: text("stitch_generation_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// Transactional outbox: HTTP routes/services insert a row here in the same
// Postgres transaction as the domain-state write (showrunner_jobs/
// video_jobs/final_videos), instead of calling BullMQ directly. A separate
// dispatcher process (scripts/outbox-dispatcher.mts) is the only thing that
// ever calls queue.add(), using job_key as BullMQ's deterministic jobId —
// so a crash between "BullMQ accepted the job" and "marked delivered" is
// safe to retry: the dispatcher just calls add() again with the same
// jobId, which BullMQ no-ops against the job it already created.
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    queue: text("queue").notNull(),
    jobName: text("job_name").notNull(),
    // Deterministic per logical operation, e.g.
    // "video-create_<projectId>_<scene>_<generationId>" — doubles as the
    // BullMQ jobId, hence "_" rather than ":" as the delimiter: BullMQ
    // rejects custom job IDs containing ":" (its own internal Redis key
    // delimiter). Unique so a duplicate insert attempt for the same
    // logical operation (belt-and-suspenders alongside the
    // upsert-with-WHERE checks in project-store.server.ts) is a no-op.
    jobKey: text("job_key").notNull(),
    payload: jsonb("payload").notNull(),
    status: outboxEventStatusEnum("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("outbox_events_job_key_idx").on(table.jobKey),
    index("outbox_events_status_available_at_idx").on(table.status, table.availableAt),
  ],
);
