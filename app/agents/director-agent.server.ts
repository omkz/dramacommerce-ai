import { callQwenJson, type QwenUsage } from "~/services/qwen.server";
import { formatSkillResult } from "~/services/skills/format-skill-result";
import { summarizeProductAnalysisSkill } from "~/services/skills/product-analysis-skill.server";
import { validateWithRepair } from "~/services/agent-json-repair.server";
import { directorPackageSchema } from "~/services/domain/schemas.server";
import type {
  DirectedScene,
  ProductAnalysis,
  ProductBrief,
  StoryBible,
} from "~/types/showrunner";

export async function runDirectorAgent(
  brief: ProductBrief,
  analysis: ProductAnalysis,
  storyBible: StoryBible,
  onUsage?: (usage: QwenUsage) => void,
): Promise<DirectedScene[]> {
  const productAnalysisSkill = summarizeProductAnalysisSkill(brief, analysis);

  const system = `You are the Director Agent for DramaCommerce AI. Return only valid JSON.`;
  const user = `
Turn this story package into a 5-scene vertical short-drama storyboard.

Story bible (compact production context — product facts, visual style, story core, constraints):
${JSON.stringify(storyBible, null, 2)}

Custom skill guidance:
${formatSkillResult("Product Analysis Skill", productAnalysisSkill)}

Return JSON:
{
  "scenes": [
    {
      "scene": 1,
      "duration": "0-4s",
      "title": "string",
      "visual": "string",
      "voiceOver": "string",
      "camera": "string, e.g. close-up / wide shot / tracking shot / macro",
      "emotion": "string, the feeling this scene should land, e.g. curious / surprised / relieved",
      "beat": "setup" | "tension" | "turning_point" | "climax" | "resolution",
      "useProductReference": boolean
    }
  ]
}

Rules:
- Create exactly 5 scenes, and assign "beat" in exactly this order — scene 1 = "setup", scene 2 = "tension", scene 3 = "turning_point", scene 4 = "climax", scene 5 = "resolution". This is a real dramatic arc, not a label: it must actually structure the 5 scenes, built around storyCore.conflict —
  1. setup: establish the conflict visually (the problem/frustration from storyCore.conflict, before the product appears).
  2. tension: the conflict continues or intensifies — still no resolution in sight.
  3. turning_point: the product enters the story here — this is the moment things start to change.
  4. climax: the peak transformation moment — the conflict visibly resolving, the emotional payoff.
  5. resolution: the resolved state, product clearly shown, setting up the CTA.
- Make the pacing fit the story bible's constraints.duration.
- Include concrete shots, motion, product placement, and emotional beats.
- Show the product's key selling points visually where possible, using only details supported by the story bible's productFacts.
- Follow the custom skill guidance when deciding which scenes can safely use the product image as a reference.
- Product reference mode controls merchant intent: "auto" means follow visualStyle.canUseAsReference, "force" means the merchant intentionally wants the uploaded image treated as a clean packshot for one hero/reference scene, and "disable" means keep all scenes text-to-video only.
- Keep each voice-over line aligned with storyCore.
- useProductReference decides whether Wan will use the actual uploaded product photo as this scene's literal first frame (image-to-video), instead of generating purely from text. Only set it to true when ALL of these hold:
  1. visualStyle.canUseAsReference is true (a bad/cluttered photo should never be forced into the video).
  2. The scene's visual composition is plausibly a continuation of the actual product photo — normally only the final hero/reveal scene, where the camera is on the product itself in a similar framing to a studio shot.
  3. Never set it true for action, environment, or b-roll scenes with a different subject or framing (e.g. a close-up of pavement, a tracking shot of a person walking) — the model would be forced to warp the static product photo into a completely different scene, producing broken video.
- In almost every case, useProductReference should be true for at most one scene (the reveal/hero scene) and false for the rest.
`;

  const rawResult = await callQwenJson({ system, user, onUsage });

  const { scenes } = await validateWithRepair(directorPackageSchema, rawResult, {
    system,
    user,
    agentLabel: "Director Agent",
  });

  return scenes;
}
