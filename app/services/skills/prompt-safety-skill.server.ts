import type { ProductAnalysis, StoryboardScene } from "~/types/showrunner";
import type { SkillResult } from "~/services/skills/types";

const UNSUPPORTED_DETAIL_PATTERNS = [
  /\bguaranteed\b/i,
  /\bmedical grade\b/i,
  /\bfda approved\b/i,
  /\bofficially certified\b/i,
];

export function evaluatePromptSafetySkill(
  storyboard: StoryboardScene[],
  analysis?: ProductAnalysis,
): SkillResult {
  const warnings: string[] = [];

  for (const scene of storyboard) {
    if (UNSUPPORTED_DETAIL_PATTERNS.some((pattern) => pattern.test(scene.videoPrompt))) {
      warnings.push(`Scene ${scene.scene} may contain unsupported regulated or absolute claims.`);
    }

    if (scene.useProductReference && !analysis?.canUseAsReference) {
      warnings.push(`Scene ${scene.scene} uses a product reference even though the image is not reference-ready.`);
    }

    if (
      scene.useProductReference &&
      /\b(street|crowd|person running|wide city|restaurant|bedroom)\b/i.test(scene.videoPrompt)
    ) {
      warnings.push(`Scene ${scene.scene} may force the reference image into an unrelated environment.`);
    }
  }

  return {
    facts: [`Checked ${storyboard.length} Wan prompts for reference and claim safety.`],
    recommendations: [
      "Keep prompts grounded in visible product traits and merchant-provided benefits.",
      "Use reference images only for product-led hero, reveal, or macro shots.",
    ],
    warnings,
  };
}
