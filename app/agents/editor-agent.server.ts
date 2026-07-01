import { z } from "zod";
import { callQwenJson } from "~/services/qwen.server";
import type {
  EditorPackage,
  ProductBrief,
  StoryboardScene,
} from "~/types/showrunner";

const editorPackageSchema = z.object({
  timeline: z.array(z.string()).min(1),
  caption: z.string(),
  cta: z.string(),
});

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
- CTA should be short and merchant-friendly.
`,
  });

  return editorPackageSchema.parse(rawResult);
}
