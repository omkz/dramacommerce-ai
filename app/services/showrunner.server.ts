import { callQwenJson } from "~/services/qwen.server";
import type { ProductBrief, ShowPlan } from "~/types/showrunner";
import { validateQwenShowPlan } from "~/services/showrunner-validator.server";

export async function generateShowPlan(brief: ProductBrief): Promise<ShowPlan> {
    const qwenPlan = await generateQwenShowPlan(brief);

    return {
        ...qwenPlan,
        source: "qwen",
    };
}

async function generateQwenShowPlan(brief: ProductBrief): Promise<ShowPlan> {
    const system = `
You are DramaCommerce AI, an AI showrunner for short product drama ads.

You create structured ad plans for TikTok, Instagram Reels, and YouTube Shorts.

Return only valid JSON.
Do not include markdown.
Do not include explanations.
`;

    const user = `
Create a short product drama ad plan from this product brief.

Product brief:
${JSON.stringify(brief, null, 2)}

Return JSON with exactly this shape:

{
  "brief": {
    "productName": "string",
    "targetAudience": "string",
    "mood": "string",
    "platform": "string",
    "duration": "string",
    "imageName": "string"
  },
  "concept": "string",
  "hook": "string",
  "voiceOver": "string",
  "storyboard": [
    {
      "scene": 1,
      "duration": "0–4s",
      "title": "string",
      "visual": "string",
      "voiceOver": "string",
      "videoPrompt": "string"
    }
  ],
  "timeline": ["string"],
  "caption": "string",
  "cta": "string"
}

Rules:
- Create exactly 5 storyboard scenes.
- Make it vertical-video friendly.
- Make the product visible but not awkwardly forced.
- The video prompts must be detailed enough for a text-to-video model.
- Use the requested mood, platform, target audience, and duration.
- Keep the ad practical for a small online merchant.
`;

    const rawResult = await callQwenJson({ system, user });

    return validateQwenShowPlan(rawResult, brief);
}
