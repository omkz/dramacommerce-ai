import { callQwenJson } from "~/services/qwen.server";
import type { QwenTool, QwenToolHandlers, QwenUsage } from "~/services/qwen.server";
import { validateStoryboard } from "~/services/showrunner-validator.server";
import type {
  DirectedScene,
  ProductBrief,
  StoryBible,
  StoryboardScene,
} from "~/types/showrunner";

const GET_WAN_VIDEO_CONSTRAINTS_TOOL: QwenTool = {
  type: "function",
  function: {
    name: "get_wan_video_constraints",
    description:
      "Get the exact resolution, aspect ratio, and per-scene duration the Wan text-to-video model will render each scene at. Call this before writing videoPrompt text so prompts describe framing and pacing that actually fit the render, instead of guessing generic vertical-video language.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

function getWanVideoConstraints(aspectRatio?: string) {
  const constraints = {
    resolution: process.env.WAN_VIDEO_RESOLUTION || "720P",
    aspectRatio: aspectRatio || process.env.WAN_VIDEO_RATIO || "9:16",
    durationSecondsPerScene: Number(process.env.WAN_VIDEO_DURATION || "5"),
  };

  console.log("[prompt-agent] get_wan_video_constraints called ->", constraints);

  return constraints;
}

export async function runPromptAgent(
  brief: ProductBrief,
  scenes: DirectedScene[],
  storyBible: StoryBible,
  revisionNotes?: string,
  onUsage?: (usage: QwenUsage) => void,
): Promise<StoryboardScene[]> {
  const promptAgentToolHandlers: QwenToolHandlers = {
    get_wan_video_constraints: () => getWanVideoConstraints(brief.aspectRatio),
  };

  const rawResult = await callQwenJson({
    system: `You are the Video Prompt Agent for DramaCommerce AI. Before writing any videoPrompt text, call get_wan_video_constraints to learn the exact resolution, aspect ratio, and duration Wan will render — don't guess. Return only valid JSON.`,
    user: `
Add Wan text-to-video prompts to each directed scene.

Story bible (compact production context — product facts, visual style, story core, constraints):
${JSON.stringify(storyBible, null, 2)}

Directed scenes:
${JSON.stringify(scenes, null, 2)}
${
  revisionNotes
    ? `
Critic feedback to address on this revision — fix these specific issues:
${revisionNotes}
`
    : ""
}
Return JSON:
{
  "storyboard": [
    {
      "scene": 1,
      "duration": "0-4s",
      "title": "string",
      "visual": "string",
      "voiceOver": "string",
      "camera": "string",
      "emotion": "string",
      "beat": "setup" | "tension" | "turning_point" | "climax" | "resolution",
      "useProductReference": boolean,
      "videoPrompt": "string"
    }
  ]
}

Rules:
- Preserve scene numbers, titles, durations, visuals, voice-over lines, camera, emotion, beat, and useProductReference from the directed scenes.
- Add detailed videoPrompt text for realistic text-to-video generation, tailored to the exact resolution/aspect ratio/duration from get_wan_video_constraints.
- Let the shot's energy follow its beat: setup/tension read quieter and more static (stillness, held frames); turning_point introduces motion/change; climax is the most dynamic and energetic framing of the five; resolution settles back down, calm and clear.
- Include camera movement, subject, setting, lighting, mood, and product visibility.
- Make product appearance and benefits clear in the shot language, but avoid inventing unsupported logos, packaging, colors, or materials.
- Avoid impossible product/logo details not present in the brief.
- Respect productReferenceMode from the brief: disable means no image-to-video reference scenes, force means the final hero/reference scene should be written like a clean packshot animation.
- When useProductReference is true for a scene, that scene's videoPrompt must describe motion that plausibly starts from a static product photo (e.g. the product rotating, camera pulling back/in) — not a different subject or setting, since the actual photo will be used as the literal first frame.
`,
    tools: [GET_WAN_VIDEO_CONSTRAINTS_TOOL],
    toolHandlers: promptAgentToolHandlers,
    requiredToolNames: ["get_wan_video_constraints"],
    onUsage,
  });

  return validateStoryboard(rawResult);
}
