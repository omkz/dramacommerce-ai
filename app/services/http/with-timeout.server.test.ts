import { test } from "node:test";
import assert from "node:assert/strict";
import { withTimeout } from "~/services/http/with-timeout.server";

test("withTimeout: resolves with the check's own result when it finishes before the bound", async () => {
  const result = await withTimeout(
    async () => "ok",
    1000,
    () => "timed-out",
  );

  assert.equal(result, "ok");
});

test("withTimeout: a dependency that never resolves still returns within the configured bound (proves /health can't hang)", async () => {
  const neverResolves = () => new Promise<string>(() => {});

  const startedAt = Date.now();
  const result = await withTimeout(neverResolves, 100, () => "timed-out");
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result, "timed-out");
  // Generous upper bound to avoid CI flakiness while still proving this
  // returns close to the configured 100ms bound, not e.g. never.
  assert.ok(elapsedMs < 1000, `expected withTimeout to return quickly, took ${elapsedMs}ms`);
});

test("withTimeout: a check that rejects before the bound still propagates the rejection", async () => {
  await assert.rejects(
    () =>
      withTimeout(
        async () => {
          throw new Error("boom");
        },
        1000,
        () => "timed-out",
      ),
    /boom/,
  );
});
