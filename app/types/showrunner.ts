export type ProductBrief = {
  productName: string;
  targetAudience: string;
  mood: string;
  platform: string;
  duration: string;
  imageName: string;
};

export type StoryPackage = {
  concept: string;
  hook: string;
  voiceOver: string;
};

export type DirectedScene = {
  scene: number;
  duration: string;
  title: string;
  visual: string;
  voiceOver: string;
};

export type StoryboardScene = DirectedScene & {
  videoPrompt: string;
};

export type EditorPackage = {
  timeline: string[];
  caption: string;
  cta: string;
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
