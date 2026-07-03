import type { ProductBrief } from "~/types/showrunner";
import type { SkillResult } from "~/services/skills/types";

export function deriveBrandVoiceSkill(brief: ProductBrief): SkillResult {
  const mood = brief.mood.toLowerCase();
  const facts = [`Requested mood: ${brief.mood}.`, `Platform: ${brief.platform}.`];
  const recommendations: string[] = [];

  if (mood.includes("premium")) {
    recommendations.push("Use concise, polished wording with restrained claims.");
  } else if (mood.includes("funny")) {
    recommendations.push("Use playful contrast, but keep the product benefit clear.");
  } else if (mood.includes("emotional")) {
    recommendations.push("Use a human problem-solution arc with warm language.");
  } else if (mood.includes("fast")) {
    recommendations.push("Use short punchy lines and high-motion cuts.");
  } else {
    recommendations.push("Use cinematic language with clear visual tension and payoff.");
  }

  if (brief.platform === "TikTok") {
    recommendations.push("Open with an immediate hook and avoid slow setup.");
  } else if (brief.platform === "Instagram Reels") {
    recommendations.push("Keep the visual style polished and shareable.");
  } else {
    recommendations.push("Make the hook legible even without sound.");
  }

  return { facts, recommendations, warnings: [] };
}
