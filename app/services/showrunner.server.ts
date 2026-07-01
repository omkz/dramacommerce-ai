import { runDirectorAgent } from "~/agents/director-agent.server";
import { runEditorAgent } from "~/agents/editor-agent.server";
import { runPromptAgent } from "~/agents/prompt-agent.server";
import { runStoryAgent } from "~/agents/story-agent.server";
import type { ProductBrief, ShowPlan } from "~/types/showrunner";

export function generateMockShowPlan(brief: ProductBrief): ShowPlan {
  const story = runStoryAgent(brief);
  const directedScenes = runDirectorAgent(brief, story);
  const storyboard = runPromptAgent(brief, directedScenes);
  const editorPackage = runEditorAgent(brief, storyboard);

  return {
    brief,
    concept: story.concept,
    hook: story.hook,
    voiceOver: story.voiceOver,
    storyboard,
    timeline: editorPackage.timeline,
    caption: editorPackage.caption,
    cta: editorPackage.cta,
  };
}
