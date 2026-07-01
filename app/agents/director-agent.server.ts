import { callQwenJson } from "~/services/qwen.server";
import { validateDirectedScenes } from "~/services/showrunner-validator.server";
import type {
  DirectedScene,
  ProductBrief,
  StoryPackage,
} from "~/types/showrunner";

export async function runDirectorAgent(
  brief: ProductBrief,
  story: StoryPackage,
): Promise<DirectedScene[]> {
  const rawResult = await callQwenJson({
    system: `You are the Director Agent for DramaCommerce AI. Return only valid JSON.`,
    user: `
Turn this story package into a 5-scene vertical short-drama storyboard.

Product brief:
${JSON.stringify(brief, null, 2)}

Story package:
${JSON.stringify(story, null, 2)}

Return JSON:
{
  "scenes": [
    {
      "scene": 1,
      "duration": "0-4s",
      "title": "string",
      "visual": "string",
      "voiceOver": "string"
    }
  ]
}

Rules:
- Create exactly 5 scenes.
- Make the pacing fit ${brief.duration}.
- Include concrete shots, motion, product placement, and emotional beats.
- Keep each voice-over line aligned with the story package.
`,
  });

  return validateDirectedScenes(rawResult);
}
