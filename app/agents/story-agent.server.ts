import { z } from "zod";
import { callQwenJson } from "~/services/qwen.server";
import type { ProductBrief, StoryPackage } from "~/types/showrunner";

const storyPackageSchema = z.object({
  concept: z.string(),
  hook: z.string(),
  voiceOver: z.string(),
});

export async function runStoryAgent(
  brief: ProductBrief,
): Promise<StoryPackage> {
  const rawResult = await callQwenJson({
    system: `You are the Story Agent for DramaCommerce AI. Return only valid JSON.`,
    user: `
Create the narrative core for a short product drama ad.

Product brief:
${JSON.stringify(brief, null, 2)}

Return JSON:
{
  "concept": "string",
  "hook": "string",
  "voiceOver": "string"
}

Rules:
- Make the story relevant to the target audience.
- Keep the product visible but naturally integrated.
- Write for ${brief.platform} in a ${brief.mood} mood.
- The voice-over should fit ${brief.duration}.
`,
  });

  return storyPackageSchema.parse(rawResult);
}
