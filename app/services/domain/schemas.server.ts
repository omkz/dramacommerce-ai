// Canonical Zod schemas for every AI-generated and merchant-edited shape in
// the showrunner pipeline. This is the ONE place these shapes are defined —
// app/types/showrunner.ts re-exports z.infer<> types from here instead of
// hand-duplicating interfaces, agents parse their own output against these
// schemas (via the bounded-repair wrapper, see agent-json-repair.server.ts),
// and project-store.server.ts validates persisted JSONB through the same
// schemas at read time. Imports only limits.server.ts (pure constants) and
// ~/services/storage/keys (a pure, dependency-free leaf module) — never a
// service that could import back into this file.
import { z } from "zod";
import {
  ARRAY_LIMITS,
  ASPECT_RATIO_OPTIONS,
  CURRENT_SHOW_PLAN_SCHEMA_VERSION,
  DRAMATIC_BEAT_OPTIONS,
  DURATION_OPTIONS,
  LIMITS,
  MOOD_OPTIONS,
  PLATFORM_OPTIONS,
  PRODUCT_REFERENCE_MODE_OPTIONS,
  SCENE_DURATION_PATTERN,
  getMaxSceneVoiceOverChars,
  getWanSceneDurationSeconds,
} from "~/services/domain/limits.server";
import { isManagedRef } from "~/services/storage/keys";

// ---------------------------------------------------------------------------
// String helpers
// ---------------------------------------------------------------------------

function requiredString(bounds: { min: number; max: number }, label: string) {
  return z
    .string()
    .trim()
    .min(Math.max(1, bounds.min), `${label} is required.`)
    .max(bounds.max, `${label} must be ${bounds.max} characters or fewer.`);
}

function optionalString(bounds: { max: number }, label: string) {
  return z
    .string()
    .trim()
    .max(bounds.max, `${label} must be ${bounds.max} characters or fewer.`)
    .optional();
}

// A custom issue counts as repair-eligible only when explicitly tagged
// repairable: true — mechanical/structural slips (duplicate scene numbers,
// an out-of-range timeline scene reference) get reprompted; business-rule or
// creative-content violations (voice-over too long for the render duration,
// a reference-image decision that contradicts the brief) never do. See
// agent-json-repair.server.ts#isRepairEligible.
function addCustomIssue(
  ctx: z.RefinementCtx,
  message: string,
  options: { path?: (string | number)[]; repairable: boolean },
): void {
  ctx.addIssue({
    code: "custom",
    message,
    path: options.path,
    params: { repairable: options.repairable },
  });
}

// ---------------------------------------------------------------------------
// Product brief
// ---------------------------------------------------------------------------

export const productBriefSchema = z.object({
  productName: requiredString(LIMITS.productName, "Product name"),
  productDescription: optionalString(LIMITS.productDescription, "Product description"),
  keySellingPoints: optionalString(LIMITS.keySellingPoints, "Key selling points"),
  offer: optionalString(LIMITS.offer, "Offer"),
  targetAudience: requiredString(LIMITS.targetAudience, "Target audience"),
  mood: z.enum(MOOD_OPTIONS, { message: "Choose a valid mood." }),
  platform: z.enum(PLATFORM_OPTIONS, { message: "Choose a valid platform." }),
  duration: z.enum(DURATION_OPTIONS, { message: "Choose a valid duration." }),
  aspectRatio: z.enum(ASPECT_RATIO_OPTIONS, { message: "Choose a valid aspect ratio." }).optional(),
  imageName: requiredString(LIMITS.imageName, "Image file name"),
  imageUrl: z.string().trim().min(1, "Image reference is required.").optional(),
  showProductOverlay: z.boolean(),
  productReferenceMode: z
    .enum(PRODUCT_REFERENCE_MODE_OPTIONS, { message: "Choose a valid product reference mode." })
    .optional(),
});

export type ProductBrief = z.infer<typeof productBriefSchema>;

// ---------------------------------------------------------------------------
// Product analysis (Analyze Agent)
// ---------------------------------------------------------------------------

export const productAnalysisSchema = z.object({
  category: requiredString(LIMITS.analysisField, "Category"),
  colors: z
    .array(requiredString(LIMITS.analysisColor, "Color"))
    .max(ARRAY_LIMITS.analysisColors.max, `At most ${ARRAY_LIMITS.analysisColors.max} colors.`),
  material: requiredString(LIMITS.analysisField, "Material"),
  brandingVisible: z.string().trim().max(LIMITS.analysisField.max).nullable(),
  quality: z.enum(["good", "medium", "poor"]),
  canUseAsReference: z.boolean(),
  issues: z
    .array(requiredString(LIMITS.analysisIssue, "Issue"))
    .max(ARRAY_LIMITS.analysisIssues.max, `At most ${ARRAY_LIMITS.analysisIssues.max} issues.`),
});

export type ProductAnalysis = z.infer<typeof productAnalysisSchema>;

// ---------------------------------------------------------------------------
// Critic result
// ---------------------------------------------------------------------------

export const criticResultSchema = z.object({
  approved: z.boolean(),
  notes: optionalString(LIMITS.criticNotes, "Critic notes"),
});

export type CriticResult = z.infer<typeof criticResultSchema>;

// ---------------------------------------------------------------------------
// Story package (Story Agent)
// ---------------------------------------------------------------------------

export const storyPackageSchema = z.object({
  concept: requiredString(LIMITS.concept, "Concept"),
  conflict: requiredString(LIMITS.conflict, "Conflict"),
  hook: requiredString(LIMITS.hook, "Hook"),
  voiceOver: requiredString(LIMITS.overallVoiceOver, "Voice-over"),
});

export type StoryPackage = z.infer<typeof storyPackageSchema>;

// ---------------------------------------------------------------------------
// Directed scene / storyboard scene (Director Agent / Prompt Agent)
// ---------------------------------------------------------------------------

export const dramaticBeatSchema = z.enum(DRAMATIC_BEAT_OPTIONS);
export type DramaticBeat = z.infer<typeof dramaticBeatSchema>;

const directedSceneShape = z.object({
  scene: z.number().int("Scene number must be an integer."),
  duration: z
    .string()
    .trim()
    .min(LIMITS.sceneDuration.min, "Scene duration is required.")
    .max(LIMITS.sceneDuration.max, `Scene duration must be ${LIMITS.sceneDuration.max} characters or fewer.`)
    .regex(SCENE_DURATION_PATTERN, 'Scene duration must look like "0-4s".'),
  title: requiredString(LIMITS.sceneTitle, "Scene title"),
  visual: requiredString(LIMITS.sceneVisual, "Scene visual"),
  voiceOver: requiredString(LIMITS.sceneVoiceOverCeiling, "Scene voice-over"),
  camera: requiredString(LIMITS.sceneCamera, "Scene camera"),
  emotion: requiredString(LIMITS.sceneEmotion, "Scene emotion"),
  beat: dramaticBeatSchema,
  useProductReference: z.boolean(),
});

// Duration-aware, not a flat character count — this is the single shared
// rule both the merchant-edit route and every agent's own output validation
// call through (see limits.server.ts#getMaxSceneVoiceOverChars). Treated as
// a business-rule violation (repairable: false), not a structural defect:
// fixing it means rewriting creative content to be shorter, not just
// correcting JSON shape.
function withSceneVoiceOverCheck<Scene extends { voiceOver: string }>(
  schema: z.ZodType<Scene>,
): z.ZodType<Scene> {
  return schema.superRefine((scene, ctx) => {
    const maxChars = getMaxSceneVoiceOverChars();

    if (scene.voiceOver.length > maxChars) {
      addCustomIssue(
        ctx,
        `Scene voice-over is too long for a ${getWanSceneDurationSeconds()}s scene (max ~${maxChars} characters) — it will get cut off mid-sentence.`,
        { path: ["voiceOver"], repairable: false },
      );
    }
  });
}

export const directedSceneSchema = withSceneVoiceOverCheck(directedSceneShape);
export type DirectedScene = z.infer<typeof directedSceneSchema>;

const storyboardSceneShape = directedSceneShape.extend({
  videoPrompt: requiredString(LIMITS.videoPrompt, "Video prompt"),
});

export const storyboardSceneSchema = withSceneVoiceOverCheck(storyboardSceneShape);
export type StoryboardScene = z.infer<typeof storyboardSceneSchema>;

// ---------------------------------------------------------------------------
// Five-scene array invariants — shared by the Director Agent's `scenes` and
// the Prompt Agent's `storyboard`. Exactly 5 scenes, scene numbers forming
// exactly {1,2,3,4,5} (no duplicates, none missing), at most one scene with
// useProductReference: true (mirrors the app-level
// normalizeReferenceSceneUsage post-processing as defense-in-depth). All
// three are mechanical slips an LLM can plausibly fix on a reprompt, so
// they're tagged repairable: true. Scenes returned out of array order are
// NOT rejected — a shuffled-but-otherwise-correct array is a cosmetic
// defect, not a content defect, so it's normalized into ascending scene
// order via .transform() instead of spending a repair attempt on it.
// ---------------------------------------------------------------------------

function fiveSceneArraySchema<Scene extends { scene: number; useProductReference: boolean }>(
  itemSchema: z.ZodType<Scene>,
) {
  return z
    .array(itemSchema)
    .length(5, "Storyboard must have exactly 5 scenes.")
    .superRefine((scenes, ctx) => {
      const numbers = scenes.map((scene) => scene.scene);
      const expected = [1, 2, 3, 4, 5];
      const missing = expected.filter((n) => !numbers.includes(n));
      const seen = new Set<number>();
      const duplicates = new Set<number>();

      for (const n of numbers) {
        if (seen.has(n)) {
          duplicates.add(n);
        }
        seen.add(n);
      }

      if (missing.length > 0) {
        addCustomIssue(ctx, `Storyboard is missing scene number(s): ${missing.join(", ")}.`, {
          repairable: true,
        });
      }

      if (duplicates.size > 0) {
        addCustomIssue(
          ctx,
          `Storyboard has duplicate scene number(s): ${[...duplicates].join(", ")}.`,
          { repairable: true },
        );
      }

      const referenceCount = scenes.filter((scene) => scene.useProductReference).length;

      if (referenceCount > 1) {
        addCustomIssue(
          ctx,
          `${referenceCount} scenes have useProductReference: true; at most 1 is allowed.`,
          { repairable: true },
        );
      }
    })
    .transform((scenes) => [...scenes].sort((a, b) => a.scene - b.scene));
}

export const directedSceneArraySchema = fiveSceneArraySchema(directedSceneSchema);
export const storyboardSceneArraySchema = fiveSceneArraySchema(storyboardSceneSchema);

export const directorPackageSchema = z.object({ scenes: directedSceneArraySchema });
export const promptPackageSchema = z.object({ storyboard: storyboardSceneArraySchema });

// ---------------------------------------------------------------------------
// Editor package
// ---------------------------------------------------------------------------

const SCENE_REFERENCE_PATTERN = /\bscene\s+(\d+)\b/gi;

// Extracted as a plain function (not baked into a schema-composition helper)
// so both editorPackageSchema's own refinement and showPlanSchema's
// defense-in-depth refinement can call it without any Zod-schema gymnastics.
function findInvalidSceneReferences(timeline: string[]): string[] {
  const invalid: string[] = [];

  for (const entry of timeline) {
    for (const match of entry.matchAll(SCENE_REFERENCE_PATTERN)) {
      const sceneNumber = Number(match[1]);

      if (!Number.isInteger(sceneNumber) || sceneNumber < 1 || sceneNumber > 5) {
        invalid.push(match[0]);
      }
    }
  }

  return invalid;
}

const editorPackageShape = z.object({
  timeline: z
    .array(requiredString(LIMITS.timelineEntry, "Timeline entry"))
    .min(1, "Timeline must include at least one entry.")
    .max(ARRAY_LIMITS.timelineEntries.max, `At most ${ARRAY_LIMITS.timelineEntries.max} timeline entries.`),
  caption: requiredString(LIMITS.caption, "Caption"),
  cta: requiredString(LIMITS.cta, "CTA"),
});

export const editorPackageSchema = editorPackageShape.superRefine((pkg, ctx) => {
  for (const reference of findInvalidSceneReferences(pkg.timeline)) {
    addCustomIssue(ctx, `Timeline references an invalid scene number: "${reference}".`, {
      path: ["timeline"],
      repairable: true,
    });
  }
});

export type EditorPackage = z.infer<typeof editorPackageSchema>;

// ---------------------------------------------------------------------------
// Token usage
// ---------------------------------------------------------------------------

export const agentTokenUsageSchema = z
  .object({
    stage: z.enum(["analyze", "story", "director", "prompt", "critic", "editor"]),
    model: requiredString({ min: 1, max: 120 }, "Model"),
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  })
  .transform((usage) => ({
    ...usage,
    // Normalized rather than rejected: this is our own bookkeeping derived
    // from provider usage fields, not model-generated creative content, and
    // a mismatch is far more likely a provider quirk (e.g. a missing usage
    // field on one tool-calling round) than a real accounting error —
    // recomputing the sum is a safe, deterministic, documented rule.
    totalTokens: usage.promptTokens + usage.completionTokens,
  }));

export type AgentTokenUsage = z.infer<typeof agentTokenUsageSchema>;

// ---------------------------------------------------------------------------
// Full show plan
// ---------------------------------------------------------------------------

export const showPlanSchema = z
  .object({
    // .default(): a persisted row written before this field existed simply
    // lacks the key, which Zod treats identically to "undefined" — the
    // default fills it in-memory (lazy normalization), and the NEXT write
    // through updateShowPlan/saveProjectAndCompleteShowrunnerJob persists it
    // for real. A present-but-invalid value (wrong type) is still a genuine
    // validation failure, not silently accepted.
    schemaVersion: z.number().int().default(CURRENT_SHOW_PLAN_SCHEMA_VERSION),
    source: z.enum(["qwen", "mock"]),
    brief: productBriefSchema,
    analysis: productAnalysisSchema,
    concept: requiredString(LIMITS.concept, "Concept"),
    conflict: requiredString(LIMITS.conflict, "Conflict"),
    hook: requiredString(LIMITS.hook, "Hook"),
    voiceOver: requiredString(LIMITS.overallVoiceOver, "Voice-over"),
    storyboard: storyboardSceneArraySchema,
    timeline: editorPackageShape.shape.timeline,
    caption: editorPackageShape.shape.caption,
    cta: editorPackageShape.shape.cta,
    tokenUsage: z.array(agentTokenUsageSchema),
  })
  .superRefine((plan, ctx) => {
    // Cross-agent consistency checks — never repair-eligible (see
    // agent-json-repair.server.ts): no single agent's repair call could fix
    // a brief-vs-storyboard mismatch, since it requires context (the brief)
    // that agent's own repair prompt doesn't carry. A failure here fails
    // generation outright, same as today's pre-existing ZodError path.
    const referenceScenes = plan.storyboard.filter((scene) => scene.useProductReference);
    const referenceMode = plan.brief.productReferenceMode ?? "auto";

    if (referenceMode === "disable" && referenceScenes.length > 0) {
      addCustomIssue(
        ctx,
        "Product reference mode is disabled but a scene still has useProductReference: true.",
        { path: ["storyboard"], repairable: false },
      );
    }

    // "Fail safely" even in force mode: force overrides the AI's photo-
    // quality judgment, but it cannot conjure a stable image reference that
    // doesn't exist at all.
    if (referenceScenes.length > 0 && !isManagedRef(plan.brief.imageUrl)) {
      addCustomIssue(
        ctx,
        "A scene uses the product reference image, but the brief has no valid stable image reference.",
        { path: ["storyboard"], repairable: false },
      );
    }

    for (const reference of findInvalidSceneReferences(plan.timeline)) {
      addCustomIssue(ctx, `Timeline references an invalid scene number: "${reference}".`, {
        path: ["timeline"],
        repairable: false,
      });
    }
  });

export type ShowPlan = z.infer<typeof showPlanSchema>;
