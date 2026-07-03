import { runAnalyzeAgent } from "~/agents/analyze-agent.server";
import { runCriticAgent } from "~/agents/critic-agent.server";
import { runDirectorAgent } from "~/agents/director-agent.server";
import { runEditorAgent } from "~/agents/editor-agent.server";
import { runPromptAgent } from "~/agents/prompt-agent.server";
import { runStoryAgent } from "~/agents/story-agent.server";
import type { ShowrunnerJobStatus } from "~/types/showrunner-status";
import type { ProductBrief, ShowPlan } from "~/types/showrunner";

export async function generateShowPlan(
    brief: ProductBrief,
    onStageChange?: (stage: ShowrunnerJobStatus) => Promise<void>,
): Promise<ShowPlan> {
    await onStageChange?.("ANALYZING");
    const analysis = await runAnalyzeAgent(brief);

    await onStageChange?.("STORY");
    const story = await runStoryAgent(brief, analysis);

    await onStageChange?.("DIRECTING");
    const directedScenes = await runDirectorAgent(brief, story, analysis);

    await onStageChange?.("PROMPTING");
    let storyboard = await runPromptAgent(brief, directedScenes);

    await onStageChange?.("CRITIQUING");
    const critique = await runCriticAgent(brief, storyboard);

    if (!critique.approved) {
        storyboard = await runPromptAgent(brief, directedScenes, critique.notes);
    }

    await onStageChange?.("EDITING");
    const editorPackage = await runEditorAgent(brief, storyboard);

    return {
        source: "qwen",
        brief,
        analysis,
        concept: story.concept,
        hook: story.hook,
        voiceOver: story.voiceOver,
        storyboard,
        timeline: editorPackage.timeline,
        caption: editorPackage.caption,
        cta: editorPackage.cta,
    };
}
