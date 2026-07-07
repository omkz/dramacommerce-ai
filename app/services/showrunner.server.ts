import { runAnalyzeAgent } from "~/agents/analyze-agent.server";
import { runCriticAgent } from "~/agents/critic-agent.server";
import { runDirectorAgent } from "~/agents/director-agent.server";
import { runEditorAgent } from "~/agents/editor-agent.server";
import { runPromptAgent } from "~/agents/prompt-agent.server";
import { runStoryAgent } from "~/agents/story-agent.server";
import { buildStoryBible } from "~/services/story-bible.server";
import type { QwenUsage } from "~/services/qwen.server";
import { evaluatePromptSafetySkill } from "~/services/skills/prompt-safety-skill.server";
import {
    evaluateVideoReadinessSkill,
    normalizeReferenceSceneUsage,
} from "~/services/skills/video-readiness-skill.server";
import type { ShowrunnerJobStatus } from "~/types/showrunner-status";
import type { AgentTokenUsage, ProductBrief, ShowPlan } from "~/types/showrunner";

const CHAT_MODEL = () => process.env.QWEN_MODEL || "qwen-plus";
const VISION_MODEL = () => process.env.QWEN_VISION_MODEL || "qwen3-vl-flash";

export async function generateShowPlan(
    brief: ProductBrief,
    onStageChange?: (stage: ShowrunnerJobStatus) => Promise<void>,
): Promise<ShowPlan> {
    const tokenUsage: AgentTokenUsage[] = [];
    const track = (stage: AgentTokenUsage["stage"], model: string) =>
        (usage: QwenUsage) => {
            tokenUsage.push({ stage, model, ...usage });
        };

    await onStageChange?.("ANALYZING");
    const analysis = await runAnalyzeAgent(brief, track("analyze", VISION_MODEL()));

    await onStageChange?.("STORY");
    const story = await runStoryAgent(brief, analysis, track("story", CHAT_MODEL()));
    const storyBible = buildStoryBible(brief, analysis, story);

    await onStageChange?.("DIRECTING");
    const directedScenes = normalizeReferenceSceneUsage(
        await runDirectorAgent(brief, analysis, storyBible, track("director", CHAT_MODEL())),
        analysis,
        brief,
    );

    await onStageChange?.("PROMPTING");
    let storyboard = await runPromptAgent(
        brief,
        directedScenes,
        storyBible,
        undefined,
        track("prompt", CHAT_MODEL()),
    );

    await onStageChange?.("CRITIQUING");
    const critique = await runCriticAgent(
        brief,
        storyboard,
        storyBible,
        analysis,
        track("critic", CHAT_MODEL()),
    );
    const skillRevisionNotes = getSkillRevisionNotes(storyboard, analysis, brief);

    if (!critique.approved || skillRevisionNotes) {
        storyboard = await runPromptAgent(
            brief,
            directedScenes,
            storyBible,
            [critique.notes, skillRevisionNotes].filter(Boolean).join("\n"),
            track("prompt", CHAT_MODEL()),
        );
    }

    await onStageChange?.("EDITING");
    const editorPackage = await runEditorAgent(
        storyboard,
        storyBible,
        track("editor", CHAT_MODEL()),
    );

    return {
        source: "qwen",
        brief,
        analysis,
        concept: story.concept,
        conflict: story.conflict,
        hook: story.hook,
        voiceOver: story.voiceOver,
        storyboard,
        timeline: editorPackage.timeline,
        caption: editorPackage.caption,
        cta: editorPackage.cta,
        tokenUsage,
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
