import { callQwenJson } from "~/services/qwen.server";
import { validateStoryPackage } from "~/services/showrunner-validator.server";
import type { ProductAnalysis, ProductBrief, StoryPackage } from "~/types/showrunner";

export async function runStoryAgent(
  brief: ProductBrief,
  analysis: ProductAnalysis,
): Promise<StoryPackage> {
  const rawResult = await callQwenJson({
    system: `You are the Story Agent for DramaCommerce AI. Return only valid JSON.`,
    user: `
Create the narrative core for a short product drama ad.

Product brief:
${JSON.stringify(brief, null, 2)}

Product photo analysis:
${JSON.stringify(analysis, null, 2)}

Return JSON:
{
  "concept": "string",
  "hook": "string",
  "voiceOver": "string"
}

Rules:
- Make the story relevant to the target audience.
- Use the product description and key selling points as the reason the product matters in the drama.
- Ground the story in what the photo analysis actually shows (category, colors, material) — don't invent product details the photo doesn't support.
- If an offer is provided, make it feel natural in the payoff instead of forcing it into every line.
- Keep the product visible but naturally integrated.
- Write for ${brief.platform} in a ${brief.mood} mood.
- The voice-over should fit ${brief.duration}.
`,
  });

  return validateStoryPackage(rawResult);
}
