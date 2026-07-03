import { runAnalyzeAgent } from "~/agents/analyze-agent.server";
import { runCriticAgent } from "~/agents/critic-agent.server";
import { runDirectorAgent } from "~/agents/director-agent.server";
import { runEditorAgent } from "~/agents/editor-agent.server";
import { runPromptAgent } from "~/agents/prompt-agent.server";
import { runStoryAgent } from "~/agents/story-agent.server";
import { evaluatePromptSafetySkill } from "~/services/skills/prompt-safety-skill.server";
import {
    evaluateVideoReadinessSkill,
    normalizeReferenceSceneUsage,
} from "~/services/skills/video-readiness-skill.server";
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
    const directedScenes = normalizeReferenceSceneUsage(
        await runDirectorAgent(brief, story, analysis),
        analysis,
        brief,
    );

    await onStageChange?.("PROMPTING");
    let storyboard = await runPromptAgent(brief, directedScenes);

    await onStageChange?.("CRITIQUING");
    const critique = await runCriticAgent(brief, storyboard, analysis);
    const skillRevisionNotes = getSkillRevisionNotes(storyboard, analysis, brief);

    if (!critique.approved || skillRevisionNotes) {
        storyboard = await runPromptAgent(
            brief,
            directedScenes,
            [critique.notes, skillRevisionNotes].filter(Boolean).join("\n"),
        );
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

function getSkillRevisionNotes(
    storyboard: Awaited<ReturnType<typeof runPromptAgent>>,
    analysis: Awaited<ReturnType<typeof runAnalyzeAgent>>,
    brief: ProductBrief,
): string | undefined {
    const checks = [
        evaluatePromptSafetySkill(storyboard, analysis),
        evaluateVideoReadinessSkill(storyboard, analysis, brief),
    ];
    const warnings = checks.flatMap((check) => check.warnings);

    return warnings.length > 0
        ? `Custom skill warnings to fix before render:\n${warnings.join("\n")}`
        : undefined;
}
