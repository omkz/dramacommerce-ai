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
  hook: string,
): Promise<EditorPackage> {
  const rawResult = await callQwenJson({
    system: `You are the Editor Agent for DramaCommerce AI. Return only valid JSON.`,
    user: `
Create the final editing package for this short product drama ad.

Product brief:
${JSON.stringify(brief, null, 2)}

Storyboard:
${JSON.stringify(storyboard, null, 2)}

Hook (cold open):
${hook}

Return JSON:
{
  "timeline": ["string"],
  "caption": "string",
  "cta": "string"
}

Rules:
- Timeline should be actionable for editing: scene timing, cuts, overlays, subtitles, sound/music notes.
- Caption should fit ${brief.platform}.
- Open or riff on the Hook line in the caption, don't just repeat the storyboard beats.
- Caption and CTA should mention the strongest product benefit or offer when provided.
- CTA should be short and merchant-friendly.
`,
  });

  return validateEditorPackage(rawResult);
}
