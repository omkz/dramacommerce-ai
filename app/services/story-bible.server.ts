import type {
  ProductAnalysis,
  ProductBrief,
  StoryBible,
  StoryPackage,
} from "~/types/showrunner";

export function buildStoryBible(
  brief: ProductBrief,
  analysis: ProductAnalysis,
  story: StoryPackage,
): StoryBible {
  return {
    productFacts: {
      name: brief.productName,
      category: analysis.category,
      colors: analysis.colors,
      material: analysis.material,
      audience: brief.targetAudience,
      keySellingPoints: brief.keySellingPoints,
      offer: brief.offer,
    },
    visualStyle: {
      mood: brief.mood,
      platform: brief.platform,
      aspectRatio: brief.aspectRatio ?? "9:16",
      quality: analysis.quality,
      canUseAsReference: analysis.canUseAsReference,
      productReferenceMode: brief.productReferenceMode ?? "auto",
    },
    storyCore: {
      concept: story.concept,
      hook: story.hook,
      voiceOver: story.voiceOver,
    },
    constraints: {
      duration: brief.duration,
    },
  };
}
