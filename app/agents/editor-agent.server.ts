import { callQwenJson, type QwenUsage } from "~/services/qwen.server";
import { validateWithRepair } from "~/services/agent-json-repair.server";
import { editorPackageSchema } from "~/services/domain/schemas.server";
import type {
  EditorPackage,
  StoryBible,
  StoryboardScene,
} from "~/types/showrunner";

export async function runEditorAgent(
  storyboard: StoryboardScene[],
  storyBible: StoryBible,
  onUsage?: (usage: QwenUsage) => void,
): Promise<EditorPackage> {
  const system = `You are the Editor Agent for DramaCommerce AI. Return only valid JSON.`;
  const user = `
Create the final editing package for this short product drama ad.

Story bible (compact production context — product facts, visual style, story core, constraints):
${JSON.stringify(storyBible, null, 2)}

Storyboard:
${JSON.stringify(storyboard, null, 2)}

Return JSON:
{
  "timeline": ["string"],
  "caption": "string",
  "cta": "string"
}

Rules:
- Timeline should be actionable for editing: scene timing, cuts, overlays, subtitles, sound/music notes.
- Caption should fit visualStyle.platform.
- Open or riff on storyCore.hook in the caption, don't just repeat the storyboard beats.
- Acknowledge storyCore.conflict (the problem the product resolves) before the payoff, so the caption reads as a resolved story, not a flat feature list.
- Caption and CTA should mention the strongest product benefit or offer from productFacts when provided.
- CTA should be short and merchant-friendly.
`;

  const rawResult = await callQwenJson({ system, user, onUsage });

  return validateWithRepair(editorPackageSchema, rawResult, {
    system,
    user,
    agentLabel: "Editor Agent",
  });
}
