import type {
  DirectedScene,
  ProductAnalysis,
  ProductBrief,
  StoryboardScene,
} from "~/types/showrunner";

export type SkillContext = {
  brief: ProductBrief;
  imageAnalysis?: ProductAnalysis;
  directedScenes?: DirectedScene[];
  storyboard?: StoryboardScene[];
};

export type SkillResult = {
  facts: string[];
  recommendations: string[];
  warnings: string[];
};
