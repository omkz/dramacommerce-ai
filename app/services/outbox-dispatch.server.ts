import { eq } from "drizzle-orm";
import { outboxEvents } from "~/db/schema";
import { db } from "~/services/db.server";
import {
  computeBackoffDelayMs,
  isMaxAttemptsReached,
  pendingEventsQuery,
  sanitizeDispatchError,
} from "~/services/outbox.server";

export type DispatchHandler = (payload: unknown, jobId: string) => Promise<unknown>;
export type DispatchHandlerRegistry = Record<string, Record<string, DispatchHandler>>;
export type DispatchOutcome = "delivered" | "skipped" | "failed" | "no-handler";

// The core outbox claim-and-dispatch step, factored out of
// scripts/outbox-dispatcher.mts so it's directly testable (that script is a
// process-lifecycle wrapper — poll loop, shutdown handling — around this).
//
// FOR UPDATE SKIP LOCKED means a row already claimed by another dispatcher
// instance (or another in-flight call to this function) is silently
// skipped rather than blocked on — that's what makes running multiple
// dispatcher instances safe. If the handler throws, the failure is
// recorded (attempts/backoff) as part of the SAME transaction rather than
// rolling back to a bare PENDING with no memory of what happened. If the
// process crashes between a successful handler call and this transaction
// committing, the transaction never commits, the row stays PENDING, and
// the next attempt calls the handler again with the same deterministic
// jobId — BullMQ no-ops against a job that already exists.
export async function dispatchOneEvent(
  id: string,
  handlers: DispatchHandlerRegistry,
): Promise<DispatchOutcome> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, id))
      .for("update", { skipLocked: true });

    if (!row || row.status !== "PENDING") {
      return "skipped";
    }

    const handler = handlers[row.queue]?.[row.jobName];

    if (!handler) {
      console.error(
        `[outbox] no dispatch handler for queue="${row.queue}" jobName="${row.jobName}" (event ${row.id}, jobKey ${row.jobKey}) — marking FAILED`,
      );
      await tx
        .update(outboxEvents)
        .set({
          status: "FAILED",
          lastError: "No dispatch handler registered for this queue/jobName.",
          updatedAt: new Date(),
        })
        .where(eq(outboxEvents.id, id));

      return "no-handler";
    }

    try {
      await handler(row.payload, row.jobKey);

      await tx
        .update(outboxEvents)
        .set({ status: "DELIVERED", processedAt: new Date(), updatedAt: new Date() })
        .where(eq(outboxEvents.id, id));

      console.log(
        `[outbox] delivered event=${row.id} jobKey=${row.jobKey} queue=${row.queue} jobName=${row.jobName}`,
      );

      return "delivered";
    } catch (error) {
      const attempts = row.attempts + 1;
      const maxedOut = isMaxAttemptsReached(attempts);

      await tx
        .update(outboxEvents)
        .set({
          status: maxedOut ? "FAILED" : "PENDING",
          attempts,
          availableAt: new Date(Date.now() + computeBackoffDelayMs(attempts)),
          lastError: sanitizeDispatchError(error),
          updatedAt: new Date(),
        })
        .where(eq(outboxEvents.id, id));

      console.error(
        `[outbox] dispatch failed event=${row.id} jobKey=${row.jobKey} attempts=${attempts}${maxedOut ? " (giving up)" : ""}: ${sanitizeDispatchError(error)}`,
      );

      return "failed";
    }
  });
}

export async function dispatchPendingEvents(
  handlers: DispatchHandlerRegistry,
  batchSize: number,
): Promise<DispatchOutcome[]> {
  const candidates = await pendingEventsQuery(db, batchSize);
  const outcomes: DispatchOutcome[] = [];

  for (const { id } of candidates) {
    outcomes.push(await dispatchOneEvent(id, handlers));
  }

  return outcomes;
}
