import type {
  DirectedScene,
  ProductAnalysis,
  ProductBrief,
  StoryboardScene,
} from "~/types/showrunner";
import type { SkillResult } from "~/services/skills/types";

type SceneWithReferenceDecision = DirectedScene | StoryboardScene;

export function normalizeReferenceSceneUsage<T extends SceneWithReferenceDecision>(
  scenes: T[],
  analysis: ProductAnalysis,
  brief?: ProductBrief,
): T[] {
  const referenceMode = brief?.productReferenceMode || "auto";

  if (referenceMode === "disable") {
    return scenes.map((scene) => ({ ...scene, useProductReference: false }));
  }

  if (referenceMode === "force") {
    const sceneToUse = Math.max(...scenes.map((scene) => scene.scene));

    return scenes.map((scene) => ({
      ...scene,
      useProductReference: scene.scene === sceneToUse,
    }));
  }

  if (!analysis.canUseAsReference) {
    return scenes.map((scene) => ({ ...scene, useProductReference: false }));
  }

  const referenceScenes = scenes.filter((scene) => scene.useProductReference);

  if (referenceScenes.length <= 1) return scenes;

  const sceneToKeep = Math.max(...referenceScenes.map((scene) => scene.scene));

  return scenes.map((scene) => ({
    ...scene,
    useProductReference: scene.scene === sceneToKeep,
  }));
}

export function evaluateVideoReadinessSkill(
  storyboard: StoryboardScene[],
  analysis?: ProductAnalysis,
  brief?: ProductBrief,
): SkillResult {
  const warnings: string[] = [];
  const referenceScenes = storyboard.filter((scene) => scene.useProductReference);
  const referenceMode = brief?.productReferenceMode || "auto";

  if (storyboard.length !== 5) {
    warnings.push(`Storyboard has ${storyboard.length} scenes instead of 5.`);
  }

  if (referenceScenes.length > 1) {
    warnings.push("More than one scene uses the product reference image; this can make Wan output less stable.");
  }

  if (
    referenceMode !== "force" &&
    referenceScenes.length > 0 &&
    !analysis?.canUseAsReference
  ) {
    warnings.push("Storyboard uses a product reference but the image analysis marked it not usable.");
  }

  if (referenceMode === "force" && analysis && !analysis.canUseAsReference) {
    warnings.push("Merchant forced packshot/reference mode even though image analysis marked the photo not usable.");
  }

  for (const scene of storyboard) {
    if (!scene.videoPrompt.trim()) {
      warnings.push(`Scene ${scene.scene} is missing a Wan prompt.`);
    }

    if (scene.voiceOver.length > 90) {
      warnings.push(`Scene ${scene.scene} voice-over may be too long for a short Wan clip.`);
    }
  }

  return {
    facts: [
      `${storyboard.length} storyboard scenes prepared.`,
      `${referenceScenes.length} scene(s) request product-reference image-to-video.`,
      `Product reference mode: ${referenceMode}.`,
    ],
    recommendations: [
      "Render all scenes only after prompts, voice-over, and reference choices pass readiness checks.",
      "Keep each scene visually focused enough for a short vertical clip.",
    ],
    warnings,
  };
}
