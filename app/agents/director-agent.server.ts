import { callQwenJson } from "~/services/qwen.server";
import { formatSkillResult } from "~/services/skills/format-skill-result";
import { summarizeProductAnalysisSkill } from "~/services/skills/product-analysis-skill.server";
import { validateDirectedScenes } from "~/services/showrunner-validator.server";
import type {
  DirectedScene,
  ProductAnalysis,
  ProductBrief,
  StoryPackage,
} from "~/types/showrunner";

export async function runDirectorAgent(
  brief: ProductBrief,
  story: StoryPackage,
  analysis: ProductAnalysis,
): Promise<DirectedScene[]> {
  const productAnalysisSkill = summarizeProductAnalysisSkill(brief, analysis);

  const rawResult = await callQwenJson({
    system: `You are the Director Agent for DramaCommerce AI. Return only valid JSON.`,
    user: `
Turn this story package into a 5-scene vertical short-drama storyboard.

Product brief:
${JSON.stringify(brief, null, 2)}

Story package:
${JSON.stringify(story, null, 2)}

Product photo analysis:
${JSON.stringify(analysis, null, 2)}

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
      "useProductReference": boolean
    }
  ]
}

Rules:
- Create exactly 5 scenes.
- Make the pacing fit ${brief.duration}.
- Include concrete shots, motion, product placement, and emotional beats.
- Show the product's key selling points visually where possible, using only details supported by the brief and the photo analysis above.
- Follow the custom skill guidance when deciding which scenes can safely use the product image as a reference.
- Product reference mode controls merchant intent: "auto" means follow analysis.canUseAsReference, "force" means the merchant intentionally wants the uploaded image treated as a clean packshot for one hero/reference scene, and "disable" means keep all scenes text-to-video only.
- Keep each voice-over line aligned with the story package.
- useProductReference decides whether Wan will use the actual uploaded product photo as this scene's literal first frame (image-to-video), instead of generating purely from text. Only set it to true when ALL of these hold:
  1. analysis.canUseAsReference is true (a bad/cluttered photo should never be forced into the video).
  2. The scene's visual composition is plausibly a continuation of the actual product photo — normally only the final hero/reveal scene, where the camera is on the product itself in a similar framing to a studio shot.
  3. Never set it true for action, environment, or b-roll scenes with a different subject or framing (e.g. a close-up of pavement, a tracking shot of a person walking) — the model would be forced to warp the static product photo into a completely different scene, producing broken video.
- In almost every case, useProductReference should be true for at most one scene (the reveal/hero scene) and false for the rest.
`,
  });

  return validateDirectedScenes(rawResult);
}
