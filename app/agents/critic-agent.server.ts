import { callQwenJson, type QwenUsage } from "~/services/qwen.server";
import { formatSkillResult } from "~/services/skills/format-skill-result";
import { evaluatePromptSafetySkill } from "~/services/skills/prompt-safety-skill.server";
import { evaluateVideoReadinessSkill } from "~/services/skills/video-readiness-skill.server";
import { validateWithRepair } from "~/services/agent-json-repair.server";
import { criticResultSchema } from "~/services/domain/schemas.server";
import type {
  CriticResult,
  ProductAnalysis,
  ProductBrief,
  StoryBible,
  StoryboardScene,
} from "~/types/showrunner";

export async function runCriticAgent(
  brief: ProductBrief,
  storyboard: StoryboardScene[],
  storyBible: StoryBible,
  analysis?: ProductAnalysis,
  onUsage?: (usage: QwenUsage) => void,
): Promise<CriticResult> {
  const promptSafety = evaluatePromptSafetySkill(storyboard, analysis);
  const videoReadiness = evaluateVideoReadinessSkill(storyboard, analysis, brief);

  const system = `You are the Critic Agent for DramaCommerce AI. Review the storyboard for quality before it goes to render. Return only valid JSON.`;
  const user = `
Review this 5-scene storyboard for a short product drama ad.

Story bible (compact production context — product facts, visual style, story core, constraints):
${JSON.stringify(storyBible, null, 2)}

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
- Scenes must be in beat order setup, tension, turning_point, climax, resolution — flag if out of order.
- Each scene's actual content (title/visual/videoPrompt) must substantively embody its assigned beat, not just carry the right label on a flat, sample-shot sequence: setup should establish storyCore.conflict visually, tension should hold the problem without resolving it yet, turning_point is where the product visibly enters, climax should read as the most dynamic/transformative shot of the five, resolution should read as calm and resolved. If a scene's beat label doesn't match what it's actually depicting, that's a defect — flag it in notes.
- Pacing that fits the story bible's constraints.duration and builds dramatically (rising and resolving), not just from hook to CTA with generic filler in between.
- Generic or repetitive scenes that don't say anything specific about the product.
- Each scene's videoPrompt actually matches its title/visual description.
- useProductReference: true is only set on a scene whose videoPrompt describes a shot that could plausibly start from a static product photo (typically a hero/reveal shot). If a scene has useProductReference: true but its videoPrompt describes unrelated action, environment, or a different subject (e.g. a close-up of pavement, a person walking), that is a real defect — the actual product photo will be forced as that scene's first frame and produce broken video. Flag it in notes.
- Treat custom skill warnings as defects unless the storyboard clearly resolves them.

Set approved to true only if there are no defects worth fixing. If approved is false, give specific, actionable notes for revising the storyboard.
`;

  const rawResult = await callQwenJson({ system, user, onUsage });

  return validateWithRepair(criticResultSchema, rawResult, {
    system,
    user,
    agentLabel: "Critic Agent",
  });
}
