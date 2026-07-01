import { z } from "zod";
import type {
  DirectedScene,
  EditorPackage,
  StoryboardScene,
  StoryPackage,
} from "~/types/showrunner";

const storyPackageSchema = z.object({
  concept: z.string(),
  hook: z.string(),
  voiceOver: z.string(),
});

const directedSceneSchema = z.object({
  scene: z.number(),
  duration: z.string(),
  title: z.string(),
  visual: z.string(),
  voiceOver: z.string(),
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
