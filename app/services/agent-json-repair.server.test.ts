import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { validateWithRepair } from "~/services/agent-json-repair.server";

const numberSchema = z.object({ value: z.number().int() });

const repairableCustomSchema = z.object({ value: z.number() }).superRefine((data, ctx) => {
  if (data.value !== 42) {
    ctx.addIssue({ code: "custom", message: "value must be 42", params: { repairable: true } });
  }
});

const businessRuleSchema = z.object({ value: z.number() }).superRefine((data, ctx) => {
  if (data.value > 100) {
    ctx.addIssue({ code: "custom", message: "value too large", params: { repairable: false } });
  }
});

const baseContext = { system: "sys", user: "task", agentLabel: "Test Agent" };

test("validateWithRepair: returns immediately when the first attempt is already valid (no repair call made)", async () => {
  let repairCalls = 0;
  const repairCaller = async () => {
    repairCalls += 1;
    return { value: 1 };
  };

  const result = await validateWithRepair(numberSchema, { value: 5 }, baseContext, undefined, repairCaller);

  assert.deepEqual(result, { value: 5 });
  assert.equal(repairCalls, 0);
});

test("validateWithRepair: a structural failure triggers exactly one repair call, and succeeds if the repair is valid", async () => {
  let repairCalls = 0;
  const repairCaller = async () => {
    repairCalls += 1;
    return { value: 7 };
  };

  const result = await validateWithRepair(
    numberSchema,
    { value: "not-a-number" },
    baseContext,
    undefined,
    repairCaller,
  );

  assert.deepEqual(result, { value: 7 });
  assert.equal(repairCalls, 1);
});

test("validateWithRepair: a repairable custom issue triggers a repair call", async () => {
  let repairCalls = 0;
  const repairCaller = async () => {
    repairCalls += 1;
    return { value: 42 };
  };

  const result = await validateWithRepair(
    repairableCustomSchema,
    { value: 1 },
    baseContext,
    undefined,
    repairCaller,
  );

  assert.deepEqual(result, { value: 42 });
  assert.equal(repairCalls, 1);
});

test("validateWithRepair: a business-rule (repairable: false) failure never calls repair and throws immediately", async () => {
  let repairCalls = 0;
  const repairCaller = async () => {
    repairCalls += 1;
    return { value: 1 };
  };

  await assert.rejects(
    () => validateWithRepair(businessRuleSchema, { value: 500 }, baseContext, undefined, repairCaller),
    (error: unknown) => {
      assert.ok(error instanceof z.ZodError);
      return true;
    },
  );

  assert.equal(repairCalls, 0, "business-rule violations must never trigger a repair call");
});

test("validateWithRepair: bounded to exactly one attempt — if the repair is still invalid, it gives up without looping", async () => {
  let repairCalls = 0;
  const repairCaller = async () => {
    repairCalls += 1;
    // Still invalid every time — proves this doesn't loop.
    return { value: "still-not-a-number" };
  };

  await assert.rejects(
    () => validateWithRepair(numberSchema, { value: "not-a-number" }, baseContext, undefined, repairCaller),
    (error: unknown) => {
      assert.ok(error instanceof z.ZodError);
      return true;
    },
  );

  assert.equal(repairCalls, 1, "must call repair exactly once, never retry the repair itself");
});

test("validateWithRepair: passes onUsage through to the repair caller", async () => {
  const usages: unknown[] = [];
  const onUsage = (usage: unknown) => usages.push(usage);
  const repairCaller = async (args: { onUsage?: (usage: unknown) => void }) => {
    args.onUsage?.({ promptTokens: 1, completionTokens: 1, totalTokens: 2 });
    return { value: 9 };
  };

  await validateWithRepair(numberSchema, { value: "bad" }, baseContext, onUsage, repairCaller as never);

  assert.equal(usages.length, 1);
});
