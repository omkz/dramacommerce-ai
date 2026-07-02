import { callQwenJson } from "~/services/qwen.server";
import { validateEditorPackage } from "~/services/showrunner-validator.server";
import type {
  EditorPackage,
  ProductBrief,
  StoryboardScene,
} from "~/types/showrunner";

export async function runEditorAgent(
  brief: ProductBrief,
  storyboard: StoryboardScene[],
): Promise<EditorPackage> {
  const rawResult = await callQwenJson({
    system: `You are the Editor Agent for DramaCommerce AI. Return only valid JSON.`,
    user: `
Create the final editing package for this short product drama ad.

Product brief:
${JSON.stringify(brief, null, 2)}

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
- Caption should fit ${brief.platform}.
- Caption and CTA should mention the strongest product benefit or offer when provided.
- CTA should be short and merchant-friendly.
`,
  });

  return validateEditorPackage(rawResult);
}
