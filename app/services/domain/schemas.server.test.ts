import { test } from "node:test";
import assert from "node:assert/strict";
import {
  productBriefSchema,
  productAnalysisSchema,
  storyPackageSchema,
  directedSceneSchema,
  storyboardSceneSchema,
  directedSceneArraySchema,
  storyboardSceneArraySchema,
  editorPackageSchema,
  agentTokenUsageSchema,
  showPlanSchema,
} from "~/services/domain/schemas.server";
import { LIMITS, DRAMATIC_BEAT_OPTIONS } from "~/services/domain/limits.server";

// --- fixtures/builders --------------------------------------------------

function makeBrief(overrides: Record<string, unknown> = {}) {
  return {
    productName: "Urban Runner Shoes",
    targetAudience: "Runners",
    mood: "Cinematic",
    platform: "TikTok",
    duration: "30 seconds",
    aspectRatio: "9:16",
    imageName: "shoe.jpg",
    imageUrl: "product-images/abc-123.jpg",
    showProductOverlay: false,
    productReferenceMode: "auto",
    ...overrides,
  };
}

function makeAnalysis(overrides: Record<string, unknown> = {}) {
  return {
    category: "footwear",
    colors: ["black", "white"],
    material: "mesh",
    brandingVisible: null,
    quality: "good",
    canUseAsReference: true,
    issues: [],
    ...overrides,
  };
}

const BEATS = [...DRAMATIC_BEAT_OPTIONS];

function makeScene(scene: number, overrides: Record<string, unknown> = {}) {
  return {
    scene,
    duration: "0-4s",
    title: `Scene ${scene} title`,
    visual: `Scene ${scene} visual description`,
    voiceOver: "Short line.",
    camera: "close-up",
    emotion: "curious",
    beat: BEATS[scene - 1] ?? "setup",
    useProductReference: false,
    ...overrides,
  };
}

function makeStoryboardScene(scene: number, overrides: Record<string, unknown> = {}) {
  return {
    ...makeScene(scene, overrides),
    videoPrompt: `Detailed Wan prompt for scene ${scene}.`,
    ...overrides,
  };
}

function makeStoryboard(overrides: Record<number, Record<string, unknown>> = {}) {
  return [1, 2, 3, 4, 5].map((n) => makeStoryboardScene(n, overrides[n] ?? {}));
}

function makeShowPlan(overrides: Record<string, unknown> = {}) {
  return {
    source: "qwen",
    brief: makeBrief(),
    analysis: makeAnalysis(),
    concept: "A concept.",
    conflict: "A conflict.",
    hook: "A hook.",
    voiceOver: "An overall voice-over.",
    storyboard: makeStoryboard(),
    timeline: ["Scene 1: open wide", "Scene 5: cta"],
    caption: "A caption.",
    cta: "Shop now",
    tokenUsage: [
      { stage: "story", model: "qwen-plus", promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    ],
    ...overrides,
  };
}

// --- product brief -------------------------------------------------------

test("productBriefSchema: accepts a valid brief", () => {
  assert.equal(productBriefSchema.safeParse(makeBrief()).success, true);
});

test("productBriefSchema: rejects a whitespace-only product name", () => {
  const result = productBriefSchema.safeParse(makeBrief({ productName: "   " }));
  assert.equal(result.success, false);
});

test("productBriefSchema: trims a padded product name", () => {
  const result = productBriefSchema.safeParse(makeBrief({ productName: "  Shoes  " }));
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.productName, "Shoes");
});

test("productBriefSchema: rejects a product name over the max length", () => {
  const result = productBriefSchema.safeParse(
    makeBrief({ productName: "x".repeat(LIMITS.productName.max + 1) }),
  );
  assert.equal(result.success, false);
});

test("productBriefSchema: accepts a product name exactly at the max length boundary", () => {
  const result = productBriefSchema.safeParse(
    makeBrief({ productName: "x".repeat(LIMITS.productName.max) }),
  );
  assert.equal(result.success, true);
});

test("productBriefSchema: rejects an invalid mood/platform/duration/aspectRatio", () => {
  assert.equal(productBriefSchema.safeParse(makeBrief({ mood: "Bogus" })).success, false);
  assert.equal(productBriefSchema.safeParse(makeBrief({ platform: "Bogus" })).success, false);
  assert.equal(productBriefSchema.safeParse(makeBrief({ duration: "5 minutes" })).success, false);
  assert.equal(productBriefSchema.safeParse(makeBrief({ aspectRatio: "4:3" })).success, false);
});

test("productBriefSchema: rejects an invalid productReferenceMode", () => {
  assert.equal(
    productBriefSchema.safeParse(makeBrief({ productReferenceMode: "always" })).success,
    false,
  );
});

// --- product analysis ------------------------------------------------------

test("productAnalysisSchema: accepts a valid analysis", () => {
  assert.equal(productAnalysisSchema.safeParse(makeAnalysis()).success, true);
});

test("productAnalysisSchema: rejects too many colors", () => {
  const result = productAnalysisSchema.safeParse(
    makeAnalysis({ colors: Array.from({ length: 50 }, (_, i) => `color-${i}`) }),
  );
  assert.equal(result.success, false);
});

test("productAnalysisSchema: allows a null brandingVisible", () => {
  assert.equal(productAnalysisSchema.safeParse(makeAnalysis({ brandingVisible: null })).success, true);
});

// --- story package ---------------------------------------------------------

test("storyPackageSchema: rejects whitespace-only conflict", () => {
  const result = storyPackageSchema.safeParse({
    concept: "c",
    conflict: "   ",
    hook: "h",
    voiceOver: "v",
  });
  assert.equal(result.success, false);
});

test("storyPackageSchema: rejects oversized concept", () => {
  const result = storyPackageSchema.safeParse({
    concept: "x".repeat(LIMITS.concept.max + 1),
    conflict: "c",
    hook: "h",
    voiceOver: "v",
  });
  assert.equal(result.success, false);
});

// --- scene-level -------------------------------------------------------

test("directedSceneSchema: rejects a non-integer scene number", () => {
  const result = directedSceneSchema.safeParse(makeScene(1.5 as unknown as number));
  assert.equal(result.success, false);
});

test("directedSceneSchema: rejects a malformed duration string", () => {
  const result = directedSceneSchema.safeParse(makeScene(1, { duration: "four seconds" }));
  assert.equal(result.success, false);
});

test("directedSceneSchema: accepts a well-formed duration with internal whitespace", () => {
  const result = directedSceneSchema.safeParse(makeScene(1, { duration: "0 - 4s" }));
  assert.equal(result.success, true);
});

test("directedSceneSchema/storyboardSceneSchema: excessive voice-over is rejected as a business-rule (not structural) violation", () => {
  // ~150 chars: over the ~75-char duration-aware bound for the 5s default,
  // but well under the 600-char structural ceiling — isolates the
  // business-rule (superRefine) check from the structural .max() check.
  const longVoiceOver = "word ".repeat(30);
  const result = storyboardSceneSchema.safeParse(makeStoryboardScene(1, { voiceOver: longVoiceOver }));

  assert.equal(result.success, false);
  if (!result.success) {
    const issue = result.error.issues.find((i) => i.path.includes("voiceOver"));
    assert.equal(issue?.code, "custom");
    assert.equal((issue as { params?: { repairable?: boolean } }).params?.repairable, false);
  }
});

// --- five-scene array invariants -------------------------------------------

test("storyboardSceneArraySchema: accepts a valid five-scene storyboard", () => {
  const result = storyboardSceneArraySchema.safeParse(makeStoryboard());
  assert.equal(result.success, true);
});

test("storyboardSceneArraySchema: rejects fewer or more than 5 scenes", () => {
  const four = [1, 2, 3, 4].map((n) => makeStoryboardScene(n));
  assert.equal(storyboardSceneArraySchema.safeParse(four).success, false);

  const six = [1, 2, 3, 4, 5, 6].map((n) => makeStoryboardScene(n));
  assert.equal(storyboardSceneArraySchema.safeParse(six).success, false);
});

test("storyboardSceneArraySchema: rejects duplicate scene numbers as repairable", () => {
  const scenes = [
    makeStoryboardScene(1),
    makeStoryboardScene(1),
    makeStoryboardScene(3),
    makeStoryboardScene(4),
    makeStoryboardScene(5),
  ];
  const result = storyboardSceneArraySchema.safeParse(scenes);
  assert.equal(result.success, false);
  if (!result.success) {
    const dupIssue = result.error.issues.find((i) => i.message.includes("duplicate"));
    assert.ok(dupIssue);
    assert.equal((dupIssue as { params?: { repairable?: boolean } }).params?.repairable, true);
  }
});

test("storyboardSceneArraySchema: rejects missing scene numbers", () => {
  const scenes = [1, 2, 3, 4].map((n) => makeStoryboardScene(n));
  scenes.push(makeStoryboardScene(4)); // duplicate 4 instead of a real scene 5
  const result = storyboardSceneArraySchema.safeParse(scenes);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error.issues.some((i) => i.message.includes("missing")));
  }
});

test("storyboardSceneArraySchema: normalizes scenes returned out of order into ascending scene order", () => {
  const shuffled = [
    makeStoryboardScene(3),
    makeStoryboardScene(1),
    makeStoryboardScene(5),
    makeStoryboardScene(2),
    makeStoryboardScene(4),
  ];
  const result = storyboardSceneArraySchema.safeParse(shuffled);
  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(
      result.data.map((s) => s.scene),
      [1, 2, 3, 4, 5],
    );
  }
});

test("directedSceneArraySchema: rejects more than one useProductReference: true scene", () => {
  const scenes = [1, 2, 3, 4, 5].map((n) => makeScene(n, { useProductReference: n >= 4 }));
  const result = directedSceneArraySchema.safeParse(scenes);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error.issues.some((i) => i.message.includes("useProductReference")));
  }
});

// --- editor package ----------------------------------------------------

test("editorPackageSchema: accepts a valid package", () => {
  const result = editorPackageSchema.safeParse({
    timeline: ["Scene 1: open", "Scene 5: cta"],
    caption: "caption",
    cta: "Shop now",
  });
  assert.equal(result.success, true);
});

test("editorPackageSchema: rejects a timeline entry referencing an out-of-range scene", () => {
  const result = editorPackageSchema.safeParse({
    timeline: ["Scene 9: nonsense"],
    caption: "caption",
    cta: "Shop now",
  });
  assert.equal(result.success, false);
});

test("editorPackageSchema: rejects an empty timeline", () => {
  const result = editorPackageSchema.safeParse({ timeline: [], caption: "c", cta: "cta" });
  assert.equal(result.success, false);
});

// --- token usage -------------------------------------------------------

test("agentTokenUsageSchema: normalizes totalTokens to promptTokens + completionTokens", () => {
  const result = agentTokenUsageSchema.safeParse({
    stage: "story",
    model: "qwen-plus",
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 999, // wrong on purpose
  });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.totalTokens, 150);
});

test("agentTokenUsageSchema: rejects negative or non-integer token counts", () => {
  assert.equal(
    agentTokenUsageSchema.safeParse({
      stage: "story",
      model: "m",
      promptTokens: -1,
      completionTokens: 0,
      totalTokens: 0,
    }).success,
    false,
  );
  assert.equal(
    agentTokenUsageSchema.safeParse({
      stage: "story",
      model: "m",
      promptTokens: 1.5,
      completionTokens: 0,
      totalTokens: 1.5,
    }).success,
    false,
  );
});

// --- full show plan ------------------------------------------------------

test("showPlanSchema: accepts a complete, valid show plan and stamps schemaVersion", () => {
  const result = showPlanSchema.safeParse(makeShowPlan());
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.schemaVersion, 1);
});

test("showPlanSchema: lazily normalizes a legacy record with no schemaVersion field", () => {
  const legacy = makeShowPlan();
  // Simulates a row written before schemaVersion existed.
  delete (legacy as Record<string, unknown>).schemaVersion;
  const result = showPlanSchema.safeParse(legacy);
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.schemaVersion, 1);
});

test("showPlanSchema: rejects when disable mode still has a reference scene (fails safely)", () => {
  const plan = makeShowPlan({
    brief: makeBrief({ productReferenceMode: "disable" }),
    storyboard: makeStoryboard({ 5: { useProductReference: true } }),
  });
  const result = showPlanSchema.safeParse(plan);
  assert.equal(result.success, false);
});

test("showPlanSchema: rejects a reference scene when the brief has no image reference at all, even in force mode", () => {
  const plan = makeShowPlan({
    brief: makeBrief({ productReferenceMode: "force", imageUrl: undefined }),
    storyboard: makeStoryboard({ 5: { useProductReference: true } }),
  });
  const result = showPlanSchema.safeParse(plan);
  assert.equal(result.success, false);
});

test("showPlanSchema: accepts a reference scene when the brief has a valid managed image reference", () => {
  const plan = makeShowPlan({
    brief: makeBrief({ productReferenceMode: "force", imageUrl: "product-images/real.jpg" }),
    storyboard: makeStoryboard({ 5: { useProductReference: true } }),
  });
  assert.equal(showPlanSchema.safeParse(plan).success, true);
});

test("showPlanSchema: rejects a corrupted record (wrong types / missing required fields)", () => {
  const corrupted = { ...makeShowPlan(), storyboard: "not-an-array", brief: null };
  assert.equal(showPlanSchema.safeParse(corrupted).success, false);
});
