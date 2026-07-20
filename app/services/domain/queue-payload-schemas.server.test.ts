import { test } from "node:test";
import assert from "node:assert/strict";
import {
  showrunnerGenerateJobDataSchema,
  videoCreateJobDataSchema,
  videoStitchJobDataSchema,
} from "~/services/domain/queue-payload-schemas.server";

test("showrunnerGenerateJobDataSchema: accepts a valid payload", () => {
  const result = showrunnerGenerateJobDataSchema.safeParse({
    showrunnerJobId: "job-1",
    userId: "user-1",
  });
  assert.equal(result.success, true);
});

test("showrunnerGenerateJobDataSchema: rejects a missing/invalid BullMQ payload", () => {
  assert.equal(showrunnerGenerateJobDataSchema.safeParse({}).success, false);
  assert.equal(showrunnerGenerateJobDataSchema.safeParse(null).success, false);
  assert.equal(showrunnerGenerateJobDataSchema.safeParse({ showrunnerJobId: 5 }).success, false);
  assert.equal(showrunnerGenerateJobDataSchema.safeParse("not-an-object").success, false);
});

test("videoCreateJobDataSchema: accepts a valid payload", () => {
  const result = videoCreateJobDataSchema.safeParse({
    projectId: "proj-1",
    scene: 3,
    prompt: "a wan prompt",
    voiceOver: "a line",
    showOverlay: false,
    generationId: "gen-1",
  });
  assert.equal(result.success, true);
});

test("videoCreateJobDataSchema: rejects an out-of-range scene number", () => {
  const result = videoCreateJobDataSchema.safeParse({
    projectId: "proj-1",
    scene: 9,
    prompt: "p",
    voiceOver: "v",
    showOverlay: false,
    generationId: "gen-1",
  });
  assert.equal(result.success, false);
});

test("videoCreateJobDataSchema: rejects an empty prompt/voiceOver", () => {
  assert.equal(
    videoCreateJobDataSchema.safeParse({
      projectId: "p",
      scene: 1,
      prompt: "",
      voiceOver: "v",
      showOverlay: false,
      generationId: "g",
    }).success,
    false,
  );
});

test("videoCreateJobDataSchema: rejects an invalid aspectRatio", () => {
  const result = videoCreateJobDataSchema.safeParse({
    projectId: "p",
    scene: 1,
    prompt: "p",
    voiceOver: "v",
    showOverlay: false,
    generationId: "g",
    aspectRatio: "4:3",
  });
  assert.equal(result.success, false);
});

test("videoStitchJobDataSchema: rejects a payload missing stitchGenerationId", () => {
  const result = videoStitchJobDataSchema.safeParse({ projectId: "p" });
  assert.equal(result.success, false);
});
