import type {
  EditorPackage,
  ProductBrief,
  StoryboardScene,
} from "~/types/showrunner";

export function runEditorAgent(
  brief: ProductBrief,
  storyboard: StoryboardScene[],
): EditorPackage {
  const { productName, targetAudience, platform } = brief;

  return {
    timeline: storyboard.map(
      (scene) => `${scene.duration}: ${scene.title} — ${scene.visual}`,
    ),
    caption: `${productName} for ${targetAudience}. Built for busy days, sharp looks, and confident movement. Perfect for ${platform}.`,
    cta: "Move faster. Look sharper.",
  };
}
