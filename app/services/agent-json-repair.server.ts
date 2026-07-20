// Bounded, one-shot JSON repair for agent output that fails structural
// validation. Scope is deliberately narrow: only Zod issues NOT tagged
// `params.repairable === false` (see app/services/domain/schemas.server.ts —
// every business-rule/creative-content refinement in that module is tagged
// explicitly) are eligible. A mechanical slip (duplicate scene numbers, a
// malformed duration string, an out-of-range timeline scene reference) is
// worth one reprompt; a business-rule violation (voice-over too long for the
// render duration, a reference-image decision that contradicts the brief)
// is never silently "fixed" by asking the model to patch its own JSON — that
// would mean either rewriting creative content the repair prompt has no
// license to judge, or weakening a constraint by pretending the model's
// second guess is authoritative. Those fail immediately, same as before this
// existed.
import { z } from "zod";
import { callQwenJson, type QwenUsage } from "~/services/qwen.server";
import { summarizeZodIssues } from "~/services/domain/errors.server";

const MAX_PRIOR_RESPONSE_CHARS = 20_000;
const MAX_REPAIR_ISSUE_LIST_CHARS = 1_500;

function isRepairEligible(error: z.ZodError): boolean {
  return error.issues.every((issue) => {
    if (issue.code !== "custom") {
      return true;
    }

    const params = issue.params as { repairable?: boolean } | undefined;
    return params?.repairable === true;
  });
}

function formatIssuesForRepairPrompt(error: z.ZodError): string {
  const lines = error.issues.slice(0, 15).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `- ${path}: ${issue.message}`;
  });

  return lines.join("\n").slice(0, MAX_REPAIR_ISSUE_LIST_CHARS);
}

export type RepairableCallContext = {
  system: string;
  user: string;
  // Short label for logs only, e.g. "Director Agent" — never included in
  // anything persisted to the database.
  agentLabel: string;
};

type RepairCaller = (args: {
  system: string;
  user: string;
  onUsage?: (usage: QwenUsage) => void;
}) => Promise<unknown>;

// Validates `rawResult` against `schema`. On a repair-eligible structural
// failure, makes exactly one follow-up Qwen call (same system prompt +
// original task + the prior malformed JSON + a summary of what to fix),
// re-validates the repaired output through the identical schema, and
// returns it. If the first attempt succeeds, isn't repair-eligible, or the
// single repair attempt still fails, no further attempts are made.
//
// `repairCaller` defaults to the real callQwenJson and is only overridden in
// tests — validateWithRepair's own logic (eligibility, bounding to one
// attempt, re-validation) is exercised against an injected fake rather than
// a real paid Qwen call.
export async function validateWithRepair<T>(
  schema: z.ZodType<T>,
  rawResult: unknown,
  context: RepairableCallContext,
  onUsage?: (usage: QwenUsage) => void,
  repairCaller: RepairCaller = callQwenJson,
): Promise<T> {
  const firstAttempt = schema.safeParse(rawResult);

  if (firstAttempt.success) {
    return firstAttempt.data;
  }

  if (!isRepairEligible(firstAttempt.error)) {
    console.warn(
      `[agent-repair] ${context.agentLabel} output failed business-rule validation (not repair-eligible):`,
      summarizeZodIssues(firstAttempt.error),
    );
    throw firstAttempt.error;
  }

  console.warn(
    `[agent-repair] ${context.agentLabel} output failed structural validation, attempting one repair call:`,
    summarizeZodIssues(firstAttempt.error),
  );

  const repairUser = `${context.user}

---
Your previous response to the task above did not match the required JSON schema. Your previous response was:
${JSON.stringify(rawResult).slice(0, MAX_PRIOR_RESPONSE_CHARS)}

Validation issues to fix (fix ONLY these — keep every other field's content exactly as you wrote it):
${formatIssuesForRepairPrompt(firstAttempt.error)}

Return the corrected JSON only, in the exact same shape as instructed above.`;

  const repairedRaw = await repairCaller({
    system: context.system,
    user: repairUser,
    onUsage,
  });

  const secondAttempt = schema.safeParse(repairedRaw);

  if (secondAttempt.success) {
    console.log(`[agent-repair] ${context.agentLabel} repair succeeded.`);
    return secondAttempt.data;
  }

  console.warn(
    `[agent-repair] ${context.agentLabel} repair attempt still invalid, giving up (bounded to one attempt):`,
    summarizeZodIssues(secondAttempt.error),
  );

  throw secondAttempt.error;
}
