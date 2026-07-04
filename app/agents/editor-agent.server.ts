import { callQwenJson, type QwenUsage } from "~/services/qwen.server";
import { validateEditorPackage } from "~/services/showrunner-validator.server";
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
  const rawResult = await callQwenJson({
    system: `You are the Editor Agent for DramaCommerce AI. Return only valid JSON.`,
    user: `
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
- Caption and CTA should mention the strongest product benefit or offer from productFacts when provided.
- CTA should be short and merchant-friendly.
`,
    onUsage,
  });

  return validateEditorPackage(rawResult);
}
