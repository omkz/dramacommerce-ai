import { z } from "zod";
import type {
  DirectedScene,
  EditorPackage,
  ProductAnalysis,
  StoryboardScene,
  StoryPackage,
} from "~/types/showrunner";

const productAnalysisSchema = z.object({
  category: z.string(),
  colors: z.array(z.string()),
  material: z.string(),
  brandingVisible: z.string().nullable(),
  quality: z.enum(["good", "medium", "poor"]),
  canUseAsReference: z.boolean(),
  issues: z.array(z.string()),
});

const criticResultSchema = z.object({
  approved: z.boolean(),
  notes: z.string().optional(),
});

const storyPackageSchema = z.object({
  concept: z.string(),
  conflict: z.string(),
  hook: z.string(),
  voiceOver: z.string(),
});

const dramaticBeatSchema = z.enum([
  "setup",
  "tension",
  "turning_point",
  "climax",
  "resolution",
]);

const directedSceneSchema = z.object({
  scene: z.number(),
  duration: z.string(),
  title: z.string(),
  visual: z.string(),
  voiceOver: z.string(),
  camera: z.string(),
  emotion: z.string(),
  beat: dramaticBeatSchema,
  useProductReference: z.boolean(),
});

const directorPackageSchema = z.object({
  scenes: z.array(directedSceneSchema).length(5),
});

const storyboardSceneSchema = directedSceneSchema.extend({
  videoPrompt: z.string(),
});

const promptPackageSchema = z.object({
  storyboard: z.array(storyboardSceneSchema).length(5),
});

const editorPackageSchema = z.object({
  timeline: z.array(z.string()).min(1),
  caption: z.string(),
  cta: z.string(),
});

export function validateProductAnalysis(raw: unknown): ProductAnalysis {
  return productAnalysisSchema.parse(raw);
}

export function validateCriticResult(raw: unknown): {
  approved: boolean;
  notes?: string;
} {
  return criticResultSchema.parse(raw);
}

export function validateStoryPackage(raw: unknown): StoryPackage {
  return storyPackageSchema.parse(raw);
}

export function validateDirectedScenes(raw: unknown): DirectedScene[] {
  return directorPackageSchema.parse(raw).scenes;
}

export function validateStoryboard(raw: unknown): StoryboardScene[] {
  return promptPackageSchema.parse(raw).storyboard;
}

export function validateEditorPackage(raw: unknown): EditorPackage {
  return editorPackageSchema.parse(raw);
}
