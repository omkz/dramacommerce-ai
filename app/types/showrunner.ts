export type ProductBrief = {
  productName: string;
  productDescription?: string;
  keySellingPoints?: string;
  offer?: string;
  targetAudience: string;
  mood: string;
  platform: string;
  duration: string;
  imageName: string;
  imageUrl?: string;
  // Optional so old stored projects without this field still parse —
  // treat undefined as true (overlay was always on before this existed).
  showProductOverlay?: boolean;
  // auto: use Analyze Agent recommendation; force: merchant intentionally
  // treats the upload as a clean packshot; disable: text-to-video only.
  productReferenceMode?: "auto" | "force" | "disable";
};

export type ProductAnalysis = {
  category: string;
  colors: string[];
  material: string;
  brandingVisible: string | null;
  quality: "good" | "medium" | "poor";
  canUseAsReference: boolean;
  issues: string[];
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
  camera: string;
  emotion: string;
  useProductReference: boolean;
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
  source: "qwen" | "mock";
  brief: ProductBrief;
  analysis?: ProductAnalysis;
  concept: string;
  hook: string;
  voiceOver: string;
  storyboard: StoryboardScene[];
  timeline: string[];
  caption: string;
  cta: string;
};
