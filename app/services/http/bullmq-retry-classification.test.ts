// Verifies the actual BullMQ retry-skipping mechanism the workers rely on
// (throwing UnrecoverableError for a permanent-category error, per
// scripts/video-worker.mjs and scripts/showrunner-worker.mts) against a real
// local Redis — BullMQ's retry/backoff bookkeeping lives entirely in Redis,
// so this isn't meaningfully fakeable the way an HTTP call is. Requires
// Redis reachable at 127.0.0.1:6379 (same default as REDIS_URL in
// .env.example); skipped automatically if unavailable rather than failing
// the whole suite in an environment without Redis.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Queue, UnrecoverableError, Worker } from "bullmq";

const connection = { host: "127.0.0.1", port: 6379 };

async function isRedisReachable(): Promise<boolean> {
  const probeQueue = new Queue(`probe-${randomUUID()}`, { connection });

  try {
    await probeQueue.waitUntilReady();
    return true;
  } catch {
    return false;
  } finally {
    await probeQueue.close().catch(() => {});
  }
}

const redisAvailable = await isRedisReachable();

test(
  "bullmq: UnrecoverableError skips remaining configured attempts",
  { skip: !redisAvailable && "Redis not reachable at 127.0.0.1:6379" },
  async () => {
    const queueName = `test-permanent-${randomUUID()}`;
    const queue = new Queue(queueName, { connection });
    let processedCount = 0;

    const worker = new Worker(
      queueName,
      async () => {
        processedCount += 1;
        throw new UnrecoverableError("permanent failure — bad API key");
      },
      { connection },
    );

    try {
      await worker.waitUntilReady();
      await queue.add("job", {}, { attempts: 5, backoff: { type: "fixed", delay: 50 } });

      // 5 attempts at 50ms fixed backoff would take >=200ms if (incorrectly)
      // retried; wait well beyond that and confirm it only ran once.
      await new Promise((resolve) => setTimeout(resolve, 600));

      assert.equal(processedCount, 1, "UnrecoverableError must not be retried even though attempts=5");
    } finally {
      await worker.close();
      await queue.obliterate({ force: true }).catch(() => {});
      await queue.close();
    }
  },
);

test(
  "bullmq: a normal thrown error retries up to the configured attempts",
  { skip: !redisAvailable && "Redis not reachable at 127.0.0.1:6379" },
  async () => {
    const queueName = `test-retry-${randomUUID()}`;
    const queue = new Queue(queueName, { connection });
    let processedCount = 0;

    const worker = new Worker(
      queueName,
      async () => {
        processedCount += 1;
        throw new Error("transient network failure");
      },
      { connection },
    );

    try {
      await worker.waitUntilReady();
      await queue.add("job", {}, { attempts: 3, backoff: { type: "fixed", delay: 50 } });

      await new Promise((resolve) => setTimeout(resolve, 800));

      assert.equal(processedCount, 3, "a retryable error should be retried until attempts are exhausted");
    } finally {
      await worker.close();
      await queue.obliterate({ force: true }).catch(() => {});
      await queue.close();
    }
  },
);
