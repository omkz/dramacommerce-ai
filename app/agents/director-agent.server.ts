import type {
  DirectedScene,
  ProductBrief,
  StoryPackage,
} from "~/types/showrunner";

export function runDirectorAgent(
  brief: ProductBrief,
  _story: StoryPackage,
): DirectedScene[] {
  const { productName } = brief;

  return [
    {
      scene: 1,
      duration: "0–4s",
      title: "The rush",
      visual:
        "A young professional checks the time, grabs a bag, and rushes out of a small apartment.",
      voiceOver: "Every morning starts with pressure.",
    },
    {
      scene: 2,
      duration: "4–8s",
      title: "Product close-up",
      visual: `Close-up shot of ${productName} being worn quickly before stepping outside.`,
      voiceOver: "The city does not slow down.",
    },
    {
      scene: 3,
      duration: "8–16s",
      title: "City movement",
      visual:
        "The character walks fast through a city street, crossing traffic, rain reflections on the road.",
      voiceOver: "But every step can feel lighter.",
    },
    {
      scene: 4,
      duration: "16–24s",
      title: "Confidence shift",
      visual:
        "The character slows down, breathes, smiles, and enters the building with confidence.",
      voiceOver: "Sharper. Faster. More confident.",
    },
    {
      scene: 5,
      duration: "24–30s",
      title: "Hero shot and CTA",
      visual: `Hero product shot of ${productName} with bold text overlay and clear call-to-action.`,
      voiceOver: "Move faster. Look sharper. Arrive ready.",
    },
  ];
}
