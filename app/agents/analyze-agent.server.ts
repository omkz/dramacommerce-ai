import { callQwenVisionJson } from "~/services/qwen.server";
import { readUploadedImageAsDataUrl } from "~/services/image-upload.server";
import { validateProductAnalysis } from "~/services/showrunner-validator.server";
import type { ProductAnalysis, ProductBrief } from "~/types/showrunner";

export async function runAnalyzeAgent(
  brief: ProductBrief,
): Promise<ProductAnalysis> {
  const imageDataUrl = await readUploadedImageAsDataUrl(brief.imageUrl);

  const rawResult = await callQwenVisionJson({
    system: `You are the Image Analysis Agent for DramaCommerce AI. Look closely at the product photo and return only valid JSON.`,
    user: `
Analyze this product photo for "${brief.productName}".

Return JSON:
{
  "category": "string",
  "colors": ["string"],
  "material": "string",
  "brandingVisible": "string or null",
  "quality": "good" | "medium" | "poor",
  "canUseAsReference": boolean,
  "issues": ["string"]
}

Rules:
- Describe only what is actually visible in the photo — do not invent details.
- "quality" reflects how usable this photo is as a hero/reference shot: lighting, framing, background clutter, focus.
- "canUseAsReference" is true only if the photo is clean and centered enough that a video could plausibly open on this exact frame and animate from it (e.g. a clear product shot), not a cluttered or badly cropped photo.
- List concrete "issues" (e.g. "background clutter", "low lighting", "product partially cropped") when relevant, empty array if none.
`,
    imageDataUrl,
  });

  return validateProductAnalysis(rawResult);
}
