import { callQwenJson } from "~/services/qwen.server";
import type { QwenTool, QwenToolHandlers } from "~/services/qwen.server";
import { validateStoryboard } from "~/services/showrunner-validator.server";
import type {
  DirectedScene,
  ProductBrief,
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

function getWanVideoConstraints() {
  const constraints = {
    resolution: process.env.WAN_VIDEO_RESOLUTION || "720P",
    aspectRatio: process.env.WAN_VIDEO_RATIO || "9:16",
    durationSecondsPerScene: Number(process.env.WAN_VIDEO_DURATION || "5"),
  };

  console.log("[prompt-agent] get_wan_video_constraints called ->", constraints);

  return constraints;
}

const promptAgentToolHandlers: QwenToolHandlers = {
  get_wan_video_constraints: () => getWanVideoConstraints(),
};

export async function runPromptAgent(
  brief: ProductBrief,
  scenes: DirectedScene[],
  revisionNotes?: string,
): Promise<StoryboardScene[]> {
  const rawResult = await callQwenJson({
    system: `You are the Video Prompt Agent for DramaCommerce AI. Before writing any videoPrompt text, call get_wan_video_constraints to learn the exact resolution, aspect ratio, and duration Wan will render — don't guess. Return only valid JSON.`,
    user: `
Add Wan text-to-video prompts to each directed scene.

Product brief:
${JSON.stringify(brief, null, 2)}

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
      "useProductReference": boolean,
      "videoPrompt": "string"
    }
  ]
}

Rules:
- Preserve scene numbers, titles, durations, visuals, voice-over lines, camera, emotion, and useProductReference from the directed scenes.
- Add detailed videoPrompt text for realistic text-to-video generation, tailored to the exact resolution/aspect ratio/duration from get_wan_video_constraints.
- Include camera movement, subject, setting, lighting, mood, and product visibility.
- Make product appearance and benefits clear in the shot language, but avoid inventing unsupported logos, packaging, colors, or materials.
- Avoid impossible product/logo details not present in the brief.
- When useProductReference is true for a scene, that scene's videoPrompt must describe motion that plausibly starts from a static product photo (e.g. the product rotating, camera pulling back/in) — not a different subject or setting, since the actual photo will be used as the literal first frame.
`,
    tools: [GET_WAN_VIDEO_CONSTRAINTS_TOOL],
    toolHandlers: promptAgentToolHandlers,
    requiredToolNames: ["get_wan_video_constraints"],
  });

  return validateStoryboard(rawResult);
}
