import { z } from "zod";
import { callQwenJson } from "~/services/qwen.server";
import type {
  DirectedScene,
  ProductBrief,
  StoryboardScene,
} from "~/types/showrunner";

const storyboardSceneSchema = z.object({
  scene: z.number(),
  duration: z.string(),
  title: z.string(),
  visual: z.string(),
  voiceOver: z.string(),
  videoPrompt: z.string(),
});

const promptPackageSchema = z.object({
  storyboard: z.array(storyboardSceneSchema).length(5),
});

export async function runPromptAgent(
  brief: ProductBrief,
  scenes: DirectedScene[],
): Promise<StoryboardScene[]> {
  const rawResult = await callQwenJson({
    system: `You are the Video Prompt Agent for DramaCommerce AI. Return only valid JSON.`,
    user: `
Add Wan text-to-video prompts to each directed scene.

Product brief:
${JSON.stringify(brief, null, 2)}

Directed scenes:
${JSON.stringify(scenes, null, 2)}

Return JSON:
{
  "storyboard": [
    {
      "scene": 1,
      "duration": "0-4s",
      "title": "string",
      "visual": "string",
      "voiceOver": "string",
      "videoPrompt": "string"
    }
  ]
}

Rules:
- Preserve scene numbers, titles, durations, visuals, and voice-over lines.
- Add detailed videoPrompt text for realistic vertical text-to-video generation.
- Include camera movement, subject, setting, lighting, mood, and product visibility.
- Avoid impossible product/logo details not present in the brief.
`,
  });

  return promptPackageSchema.parse(rawResult).storyboard;
}
