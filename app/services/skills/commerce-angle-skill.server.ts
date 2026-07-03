import type { ProductBrief } from "~/types/showrunner";
import type { SkillResult } from "~/services/skills/types";

export function deriveCommerceAngleSkill(brief: ProductBrief): SkillResult {
  const lowerText = [
    brief.productName,
    brief.productDescription,
    brief.keySellingPoints,
    brief.offer,
    brief.targetAudience,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const facts = [
    `Target audience: ${brief.targetAudience}.`,
    brief.keySellingPoints
      ? `Merchant selling points: ${brief.keySellingPoints}.`
      : "Merchant did not provide explicit selling points.",
  ];
  const recommendations: string[] = [];
  const warnings: string[] = [];

  if (lowerText.includes("comfort") || lowerText.includes("soft")) {
    recommendations.push("Lead with comfort as the emotional payoff.");
  } else if (lowerText.includes("premium") || lowerText.includes("luxury")) {
    recommendations.push("Lead with status, craft, and premium presentation.");
  } else if (lowerText.includes("fast") || lowerText.includes("quick")) {
    recommendations.push("Lead with speed and reduced friction.");
  } else {
    recommendations.push("Lead with the clearest practical transformation for the target audience.");
  }

  if (brief.offer) {
    recommendations.push(`Use the offer as the final conversion beat: ${brief.offer}.`);
  } else {
    warnings.push("No offer was provided, so the CTA should focus on product desire.");
  }

  recommendations.push("Address one objection visually before the final CTA.");

  return { facts, recommendations, warnings };
}
