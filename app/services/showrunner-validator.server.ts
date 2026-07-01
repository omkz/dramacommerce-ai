import { z } from "zod";
import type { ProductBrief, ShowPlan } from "~/types/showrunner";

const storyboardSceneSchema = z.object({
  scene: z.number(),
  duration: z.string(),
  title: z.string(),
  visual: z.string(),
  voiceOver: z.string(),
  videoPrompt: z.string(),
});

const qwenShowPlanSchema = z.object({
  brief: z.object({
    productName: z.string(),
    targetAudience: z.string(),
    mood: z.string(),
    platform: z.string(),
    duration: z.string(),
    imageName: z.string(),
  }),
  concept: z.string(),
  hook: z.string(),
  voiceOver: z.string(),
  storyboard: z.array(storyboardSceneSchema).length(5),
  timeline: z.array(z.string()).min(1),
  caption: z.string(),
  cta: z.string(),
});

export function validateQwenShowPlan(
  raw: unknown,
  brief: ProductBrief,
): ShowPlan {
  const parsed = qwenShowPlanSchema.parse(raw);

  return {
    source: "qwen",
    brief,
    concept: parsed.concept,
    hook: parsed.hook,
    voiceOver: parsed.voiceOver,
    storyboard: parsed.storyboard,
    timeline: parsed.timeline,
    caption: parsed.caption,
    cta: parsed.cta,
  };
}
