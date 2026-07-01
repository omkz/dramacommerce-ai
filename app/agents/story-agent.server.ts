import type { ProductBrief, StoryPackage } from "~/types/showrunner";

export function runStoryAgent(brief: ProductBrief): StoryPackage {
  const { productName, mood } = brief;

  return {
    concept: `A ${mood.toLowerCase()} short product drama where a busy commuter almost loses confidence before an important moment, then ${productName} becomes the subtle product hero that helps them move with speed, comfort, and style.`,
    hook: "What if your shoes could change the way your day begins?",
    voiceOver: `Every morning starts with pressure. The train is leaving. The meeting is waiting. The city does not slow down. But with ${productName}, every step feels lighter, sharper, and more confident. Move faster. Look sharper. Arrive ready.`,
  };
}
