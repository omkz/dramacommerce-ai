export type StoryboardScene = {
  scene: number;
  duration: string;
  title: string;
  visual: string;
  voiceOver: string;
  videoPrompt: string;
};

export type ProductBrief = {
  productName: string;
  targetAudience: string;
  mood: string;
  platform: string;
  duration: string;
  imageName: string;
};

export type ShowPlan = {
  brief: ProductBrief;
  concept: string;
  hook: string;
  voiceOver: string;
  storyboard: StoryboardScene[];
  timeline: string[];
  caption: string;
  cta: string;
};

export function generateMockShowPlan(brief: ProductBrief): ShowPlan {
  const { productName, targetAudience, mood, platform } = brief;

  return {
    brief,
    concept: `A ${mood.toLowerCase()} short product drama where a busy commuter almost loses confidence before an important moment, then ${productName} becomes the subtle product hero that helps them move with speed, comfort, and style.`,
    hook: `What if your shoes could change the way your day begins?`,
    voiceOver: `Every morning starts with pressure. The train is leaving. The meeting is waiting. The city does not slow down. But with ${productName}, every step feels lighter, sharper, and more confident. Move faster. Look sharper. Arrive ready.`,
    storyboard: [
      {
        scene: 1,
        duration: "0–4s",
        title: "The rush",
        visual:
          "A young professional checks the time, grabs a bag, and rushes out of a small apartment.",
        voiceOver: "Every morning starts with pressure.",
        videoPrompt: `Vertical ${platform} video, ${mood.toLowerCase()} lighting, young professional rushing out of apartment, urban morning atmosphere, fast camera movement, realistic commercial style.`,
      },
      {
        scene: 2,
        duration: "4–8s",
        title: "Product close-up",
        visual: `Close-up shot of ${productName} being worn quickly before stepping outside.`,
        voiceOver: "The city does not slow down.",
        videoPrompt: `Cinematic close-up of ${productName}, hands tying the shoes, premium product detail shot, shallow depth of field, realistic lighting, vertical video.`,
      },
      {
        scene: 3,
        duration: "8–16s",
        title: "City movement",
        visual:
          "The character walks fast through a city street, crossing traffic, rain reflections on the road.",
        voiceOver: "But every step can feel lighter.",
        videoPrompt: `Urban commuter walking fast through city street, subtle rain reflections, stylish outfit, dynamic tracking shot, ${mood.toLowerCase()} commercial video, vertical frame.`,
      },
      {
        scene: 4,
        duration: "16–24s",
        title: "Confidence shift",
        visual:
          "The character slows down, breathes, smiles, and enters the building with confidence.",
        voiceOver: "Sharper. Faster. More confident.",
        videoPrompt: `Young professional entering modern office building confidently, soft cinematic lighting, emotional shift, product visible but natural, premium ad style.`,
      },
      {
        scene: 5,
        duration: "24–30s",
        title: "Hero shot and CTA",
        visual: `Hero product shot of ${productName} with bold text overlay and clear call-to-action.`,
        voiceOver: "Move faster. Look sharper. Arrive ready.",
        videoPrompt: `Hero shot of ${productName}, clean dark background, dramatic light sweep, bold text overlay, premium e-commerce advertisement, vertical ${platform} ending shot.`,
      },
    ],
    timeline: [
      "0–4s: Hook with character problem",
      "4–8s: Product close-up",
      "8–16s: Movement and lifestyle scene",
      "16–24s: Emotional transformation",
      "24–30s: Product hero shot and CTA",
    ],
    caption: `${productName} for ${targetAudience}. Built for busy days, sharp looks, and confident movement. Perfect for ${platform}.`,
    cta: "Move faster. Look sharper.",
  };
}
