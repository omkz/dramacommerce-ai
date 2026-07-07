export type ProductBrief = {
  productName: string;
  productDescription?: string;
  keySellingPoints?: string;
  offer?: string;
  targetAudience: string;
  mood: string;
  platform: string;
  duration: string;
  aspectRatio?: "9:16" | "1:1" | "16:9";
  imageName: string;
  imageUrl?: string;
  showProductOverlay: boolean;
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
  // The concrete obstacle/tension the product resolves — the dramatic
  // engine the rest of the pipeline (Director's scene 1 setup, Editor's
  // caption) references, instead of jumping straight to ad copy.
  conflict: string;
  hook: string;
  voiceOver: string;
};

// A fixed 5-scene format maps 1:1 onto a 5-beat dramatic arc.
export type DramaticBeat =
  | "setup"
  | "tension"
  | "turning_point"
  | "climax"
  | "resolution";

export type DirectedScene = {
  scene: number;
  duration: string;
  title: string;
  visual: string;
  voiceOver: string;
  camera: string;
  emotion: string;
  beat: DramaticBeat;
  useProductReference: boolean;
};

export type StoryboardScene = DirectedScene & {
  videoPrompt: string;
};

// Compact working-memory context handed to Director/Prompt/Critic/Editor
// instead of re-serializing the full brief/analysis/story objects into every
// prompt — those agents don't need every raw field (imageUrl, imageName,
// showProductOverlay aren't creative context), just the facts that actually
// shape their output.
export type StoryBible = {
  productFacts: {
    name: string;
    category: string;
    colors: string[];
    material: string;
    audience: string;
    keySellingPoints?: string;
    offer?: string;
  };
  visualStyle: {
    mood: string;
    platform: string;
    aspectRatio: "9:16" | "1:1" | "16:9";
    quality: "good" | "medium" | "poor";
    canUseAsReference: boolean;
    productReferenceMode: "auto" | "force" | "disable";
  };
  storyCore: {
    concept: string;
    conflict: string;
    hook: string;
    voiceOver: string;
  };
  constraints: {
    duration: string;
  };
};

export type AgentTokenUsage = {
  stage: "analyze" | "story" | "director" | "prompt" | "critic" | "editor";
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type EditorPackage = {
  timeline: string[];
  caption: string;
  cta: string;
};

export type ShowPlan = {
  source: "qwen" | "mock";
  brief: ProductBrief;
  analysis: ProductAnalysis;
  concept: string;
  conflict: string;
  hook: string;
  voiceOver: string;
  storyboard: StoryboardScene[];
  timeline: string[];
  caption: string;
  cta: string;
  tokenUsage: AgentTokenUsage[];
};
