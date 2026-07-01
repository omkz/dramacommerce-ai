import { runDirectorAgent } from "~/agents/director-agent.server";
import { runEditorAgent } from "~/agents/editor-agent.server";
import { runPromptAgent } from "~/agents/prompt-agent.server";
import { runStoryAgent } from "~/agents/story-agent.server";
import type { ProductBrief, ShowPlan } from "~/types/showrunner";

export async function generateShowPlan(brief: ProductBrief): Promise<ShowPlan> {
    const story = await runStoryAgent(brief);
    const directedScenes = await runDirectorAgent(brief, story);
    const storyboard = await runPromptAgent(brief, directedScenes);
    const editorPackage = await runEditorAgent(brief, storyboard);

    return {
        source: "qwen",
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
