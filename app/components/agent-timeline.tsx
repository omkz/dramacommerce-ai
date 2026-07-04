export const AGENT_TIMELINE_STAGES = [
  {
    key: "analyze",
    label: "Analyze Agent",
    description: "Reads the product photo for category, colors, and quality.",
  },
  {
    key: "story",
    label: "Story Agent",
    description: "Writes the concept, hook, and voice-over.",
  },
  {
    key: "director",
    label: "Director Agent",
    description: "Blocks the five-scene storyboard.",
  },
  {
    key: "prompt",
    label: "Prompt Agent",
    description: "Writes Wan-ready video prompts per scene.",
  },
  {
    key: "critic",
    label: "Critic Agent",
    description: "Reviews the storyboard before it goes to render.",
  },
  {
    key: "editor",
    label: "Editor Agent",
    description: "Cuts the timeline, caption, and CTA.",
  },
  {
    key: "render",
    label: "Render",
    description: "Wan turns each scene prompt into a video clip.",
  },
  {
    key: "stitch",
    label: "Stitch",
    description: "ffmpeg joins the five clips into one final ad.",
  },
] as const;

export type AgentTimelineStageKey = (typeof AGENT_TIMELINE_STAGES)[number]["key"];

export type TimelineStageState = "pending" | "active" | "done" | "failed";

export function AgentTimeline({
  states,
  orientation = "vertical",
}: {
  states: Record<AgentTimelineStageKey, TimelineStageState>;
  orientation?: "vertical" | "horizontal";
}) {
  if (orientation === "horizontal") {
    return (
      <ol className="flex items-start gap-1 overflow-x-auto pb-2 sm:gap-2">
        {AGENT_TIMELINE_STAGES.map((stage, index) => {
          const state = states[stage.key];
          const previousState =
            index > 0 ? states[AGENT_TIMELINE_STAGES[index - 1].key] : undefined;

          return (
            <li
              key={stage.key}
              className="flex min-w-[100px] flex-1 flex-col items-center gap-2 text-center"
            >
              <div className="flex w-full items-center">
                <span
                  className={getConnectorClassName(index > 0 && previousState === "done")}
                />
                <span className={getStageCircleClassName(state)}>
                  {state === "done" ? "✓" : index + 1}
                </span>
                <span
                  className={getConnectorClassName(
                    index < AGENT_TIMELINE_STAGES.length - 1 && state === "done",
                  )}
                />
              </div>

              <div className="flex items-center gap-1.5">
                <p
                  className={
                    state === "pending"
                      ? "text-[11px] font-semibold text-ash"
                      : "text-[11px] font-semibold text-bone"
                  }
                >
                  {stage.label}
                </p>

                {state === "active" ? (
                  <span
                    className="tally-dot h-1.5 w-1.5 shrink-0 rounded-full bg-gold"
                    aria-hidden
                  />
                ) : null}
              </div>

              <span className="font-mono text-[9px] uppercase tracking-widest text-ash">
                {stateLabel(state)}
              </span>
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <ol className="space-y-3">
      {AGENT_TIMELINE_STAGES.map((stage, index) => {
        const state = states[stage.key];

        return (
          <li
            key={stage.key}
            className="flex items-start gap-4 rounded-sm border border-paper/10 bg-panel-raised p-4"
          >
            <span className={getStageCircleClassName(state)}>
              {state === "done" ? "✓" : index + 1}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p
                  className={
                    state === "pending"
                      ? "text-sm font-semibold text-ash"
                      : "text-sm font-semibold text-bone"
                  }
                >
                  {stage.label}
                </p>

                {state === "active" ? (
                  <span
                    className="tally-dot h-1.5 w-1.5 rounded-full bg-gold"
                    aria-hidden
                  />
                ) : null}
              </div>

              <p className="mt-0.5 text-xs leading-5 text-ash">
                {stage.description}
              </p>
            </div>

            <span className="font-mono text-[10px] uppercase tracking-widest text-ash">
              {stateLabel(state)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function getStageCircleClassName(state: TimelineStageState): string {
  if (state === "failed") {
    return "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-flame/50 font-mono text-xs font-semibold text-flame";
  }

  if (state === "done") {
    return "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gold/60 bg-gold/15 font-mono text-xs font-semibold text-gold";
  }

  if (state === "active") {
    return "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gold/40 font-mono text-xs font-semibold text-gold";
  }

  return "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-paper/20 font-mono text-xs font-semibold text-ash";
}

function getConnectorClassName(active: boolean): string {
  return active ? "h-px flex-1 bg-gold/50" : "h-px flex-1 bg-paper/15";
}

function stateLabel(state: TimelineStageState): string {
  if (state === "done") return "Done";
  if (state === "active") return "Running";
  if (state === "failed") return "Failed";
  return "Waiting";
}
