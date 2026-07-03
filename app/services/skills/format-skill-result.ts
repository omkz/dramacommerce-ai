import type { SkillResult } from "~/services/skills/types";

export function formatSkillResult(title: string, result: SkillResult): string {
  return [
    `${title}:`,
    `Facts: ${formatList(result.facts)}`,
    `Recommendations: ${formatList(result.recommendations)}`,
    `Warnings: ${formatList(result.warnings)}`,
  ].join("\n");
}

function formatList(items: string[]): string {
  return items.length > 0 ? items.join(" | ") : "None";
}
