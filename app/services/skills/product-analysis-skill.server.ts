import type { ProductAnalysis, ProductBrief } from "~/types/showrunner";
import type { SkillResult } from "~/services/skills/types";

export function summarizeProductAnalysisSkill(
  brief: ProductBrief,
  analysis: ProductAnalysis,
): SkillResult {
  const facts = [
    `${brief.productName} appears to be a ${analysis.category}.`,
    `Visible colors: ${analysis.colors.join(", ") || "not clear"}.`,
    `Visible material: ${analysis.material}.`,
    `Photo quality is ${analysis.quality}.`,
  ];

  if (analysis.brandingVisible) {
    facts.push(`Visible branding: ${analysis.brandingVisible}.`);
  }

  const warnings = [...analysis.issues];

  if (!analysis.canUseAsReference) {
    warnings.push("Do not force this image as a Wan reference frame.");
  }

  return {
    facts,
    recommendations: [
      "Use only visual claims supported by the product photo.",
      analysis.canUseAsReference
        ? "Reserve product-reference animation for a hero or macro product scene."
        : "Use text-to-video for all scenes unless a cleaner product image is uploaded.",
    ],
    warnings,
  };
}
