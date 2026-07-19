import { and, asc, eq, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { outboxEvents } from "~/db/schema";
import { db } from "~/services/db.server";
import * as schema from "~/db/schema";

// Accepted by every outbox-writing helper so callers can pass either the
// top-level `db` or a `tx` from db.transaction(...) — the outbox insert
// must run in the SAME transaction as the domain-state write it accompanies
// for the atomicity guarantee to hold.
export type DbExecutor = NodePgDatabase<typeof schema>;

export type OutboxInsert = {
  queue: string;
  jobName: string;
  jobKey: string;
  payload: unknown;
  availableAt?: Date;
};

const MAX_DISPATCH_ATTEMPTS = Number(process.env.OUTBOX_DISPATCH_MAX_ATTEMPTS || "10");
const BASE_BACKOFF_MS = Number(process.env.OUTBOX_DISPATCH_BASE_BACKOFF_MS || "2000");
const MAX_BACKOFF_MS = Number(
  process.env.OUTBOX_DISPATCH_MAX_BACKOFF_MS || String(5 * 60 * 1000),
);

// Inserts an outbox event, or no-ops if one with the same jobKey already
// exists (ON CONFLICT DO NOTHING) — the belt-and-suspenders backstop behind
// the upsert-with-WHERE idempotency checks in project-store.server.ts.
// Returns the inserted row, or undefined if it was a duplicate.
export async function insertOutboxEvent(
  executor: DbExecutor,
  event: OutboxInsert,
): Promise<typeof outboxEvents.$inferSelect | undefined> {
  const now = new Date();

  const [row] = await executor
    .insert(outboxEvents)
    .values({
      queue: event.queue,
      jobName: event.jobName,
      jobKey: event.jobKey,
      payload: event.payload,
      status: "PENDING",
      attempts: 0,
      availableAt: event.availableAt ?? now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: outboxEvents.jobKey })
    .returning();

  return row;
}

export function computeBackoffDelayMs(attempts: number): number {
  const delay = BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1);

  return Math.min(delay, MAX_BACKOFF_MS);
}

export function isMaxAttemptsReached(attempts: number): boolean {
  return attempts >= MAX_DISPATCH_ATTEMPTS;
}

// Never includes the raw error object or payload contents (may carry user
// data or provider responses) — only a whitelisted, length-capped message.
export function sanitizeDispatchError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return message.slice(0, 500);
}

export type OutboxStats = {
  pendingCount: number;
  oldestPendingAgeSeconds: number | null;
  failedCount: number;
};

export async function getOutboxStats(): Promise<OutboxStats> {
  const [pendingRow] = await db
    .select({
      count: sql<number>`count(*)::int`,
      oldest: sql<string | null>`min(${outboxEvents.createdAt})`,
    })
    .from(outboxEvents)
    .where(eq(outboxEvents.status, "PENDING"));

  const [failedRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(outboxEvents)
    .where(eq(outboxEvents.status, "FAILED"));

  const oldestPendingAgeSeconds = pendingRow?.oldest
    ? Math.max(0, Math.round((Date.now() - new Date(pendingRow.oldest).getTime()) / 1000))
    : null;

  return {
    pendingCount: pendingRow?.count ?? 0,
    oldestPendingAgeSeconds,
    failedCount: failedRow?.count ?? 0,
  };
}

export type OutboxCleanupResult = {
  deliveredDeleted: number;
  failedDeleted: number;
};

// Retention: delivered events are only kept around briefly for debugging;
// permanently failed events are kept longer since they're the ones worth
// investigating. Both are bounded so the table can't grow indefinitely.
export async function cleanupOutboxEvents({
  deliveredRetentionMs = Number(
    process.env.OUTBOX_DELIVERED_RETENTION_MS || 24 * 60 * 60 * 1000,
  ),
  failedRetentionMs = Number(
    process.env.OUTBOX_FAILED_RETENTION_MS || 14 * 24 * 60 * 60 * 1000,
  ),
}: {
  deliveredRetentionMs?: number;
  failedRetentionMs?: number;
} = {}): Promise<OutboxCleanupResult> {
  const now = Date.now();

  const deliveredDeleted = await db
    .delete(outboxEvents)
    .where(
      and(
        eq(outboxEvents.status, "DELIVERED"),
        lt(outboxEvents.updatedAt, new Date(now - deliveredRetentionMs)),
      ),
    )
    .returning({ id: outboxEvents.id });

  const failedDeleted = await db
    .delete(outboxEvents)
    .where(
      and(
        eq(outboxEvents.status, "FAILED"),
        lt(outboxEvents.updatedAt, new Date(now - failedRetentionMs)),
      ),
    )
    .returning({ id: outboxEvents.id });

  return {
    deliveredDeleted: deliveredDeleted.length,
    failedDeleted: failedDeleted.length,
  };
}

// Exposed for the dispatcher's polling query — kept here so the "what
// counts as claimable" definition lives next to the rest of the outbox
// domain logic rather than duplicated in scripts/outbox-dispatcher.mts.
export function pendingEventsQuery(executor: DbExecutor, limit: number) {
  return executor
    .select({ id: outboxEvents.id })
    .from(outboxEvents)
    .where(and(eq(outboxEvents.status, "PENDING"), sql`${outboxEvents.availableAt} <= now()`))
    .orderBy(asc(outboxEvents.createdAt))
    .limit(limit);
}
