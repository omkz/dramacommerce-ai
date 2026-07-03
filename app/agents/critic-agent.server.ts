import { callQwenJson } from "~/services/qwen.server";
import { formatSkillResult } from "~/services/skills/format-skill-result";
import { evaluatePromptSafetySkill } from "~/services/skills/prompt-safety-skill.server";
import { evaluateVideoReadinessSkill } from "~/services/skills/video-readiness-skill.server";
import { validateCriticResult } from "~/services/showrunner-validator.server";
import type { ProductAnalysis, ProductBrief, StoryboardScene } from "~/types/showrunner";

export async function runCriticAgent(
  brief: ProductBrief,
  storyboard: StoryboardScene[],
  analysis?: ProductAnalysis,
): Promise<{ approved: boolean; notes?: string }> {
  const promptSafety = evaluatePromptSafetySkill(storyboard, analysis);
  const videoReadiness = evaluateVideoReadinessSkill(storyboard, analysis, brief);

  const rawResult = await callQwenJson({
    system: `You are the Critic Agent for DramaCommerce AI. Review the storyboard for quality before it goes to render. Return only valid JSON.`,
    user: `
Review this 5-scene storyboard for a short product drama ad.

Product brief:
${JSON.stringify(brief, null, 2)}

Storyboard:
${JSON.stringify(storyboard, null, 2)}

Custom skill checks:
${formatSkillResult("Prompt Safety Skill", promptSafety)}

${formatSkillResult("Video Readiness Skill", videoReadiness)}

Return JSON:
{
  "approved": boolean,
  "notes": "string, only when approved is false"
}

Check for:
- Pacing that fits ${brief.duration} and builds from hook to CTA without dead scenes.
- Generic or repetitive scenes that don't say anything specific about the product.
- Each scene's videoPrompt actually matches its title/visual description.
- useProductReference: true is only set on a scene whose videoPrompt describes a shot that could plausibly start from a static product photo (typically a hero/reveal shot). If a scene has useProductReference: true but its videoPrompt describes unrelated action, environment, or a different subject (e.g. a close-up of pavement, a person walking), that is a real defect — the actual product photo will be forced as that scene's first frame and produce broken video. Flag it in notes.
- Treat custom skill warnings as defects unless the storyboard clearly resolves them.

Set approved to true only if there are no defects worth fixing. If approved is false, give specific, actionable notes for revising the storyboard.
`,
  });

  return validateCriticResult(rawResult);
}
