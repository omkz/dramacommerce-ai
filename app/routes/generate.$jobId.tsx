import { useEffect } from "react";
import { Link, redirect, useLoaderData, useRevalidator } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { getShowrunnerJob } from "~/services/project-store.server";
import { requireUser } from "~/services/auth.server";
import {
  AgentTimeline,
  type AgentTimelineStageKey,
  type TimelineStageState,
} from "~/components/agent-timeline";
import type { ShowrunnerJobStatus } from "~/types/showrunner-status";

const STAGE_ORDER: ShowrunnerJobStatus[] = [
  "QUEUED",
  "ANALYZING",
  "STORY",
  "DIRECTING",
  "PROMPTING",
  "CRITIQUING",
  "EDITING",
  "SUCCEEDED",
];

const AGENT_STAGE_KEYS: AgentTimelineStageKey[] = [
  "analyze",
  "story",
  "director",
  "prompt",
  "critic",
  "editor",
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const jobId = params.jobId;

  if (!jobId) {
    throw new Response("Job ID is required", { status: 400 });
  }

  const job = await getShowrunnerJob(jobId, user.id);

  if (!job) {
    throw new Response("Generation job not found", { status: 404 });
  }

  if (job.status === "SUCCEEDED" && job.projectId) {
    throw redirect(`/projects/${job.projectId}`);
  }

  return job;
}

export function meta() {
  return [
    { title: "Generating Product Drama | DramaCommerce AI" },
    {
      name: "description",
      content: "Live status of the AI showrunner pipeline.",
    },
  ];
}

export default function GenerateJobStatus() {
  const job = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const isTerminal = job.status === "SUCCEEDED" || job.status === "FAILED";

  useEffect(() => {
    if (isTerminal) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (revalidator.state === "idle") {
        revalidator.revalidate();
      }
    }, 3_000);

    return () => window.clearInterval(intervalId);
  }, [revalidator, isTerminal]);

  const states = buildAgentStates(job.status);

  return (
    <main className="min-h-screen bg-ink px-6 py-10 text-bone">
      <div className="mx-auto max-w-3xl">
        <Link to="/generate" className="text-sm text-ash hover:text-bone">
          ← Back to brief
        </Link>

        <div className="mt-10">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-gold">
            Production
          </p>

          <h1 className="mt-4 font-display text-4xl font-medium tracking-tight text-bone md:text-5xl">
            {job.brief.productName}
          </h1>

          <p className="mt-4 flex items-center gap-2 text-ash">
            {job.status === "FAILED" ? (
              "Generation failed."
            ) : (
              <>
                <span
                  className="tally-dot h-1.5 w-1.5 rounded-full bg-gold"
                  aria-hidden
                />
                The production crew is working on your ad. This page updates
                automatically.
              </>
            )}
          </p>
        </div>

        <div className="mt-8 rounded-lg border border-paper/10 bg-panel p-6">
          <AgentTimeline
            states={{
              ...states,
              render: "pending",
              stitch: "pending",
            }}
          />
        </div>

        {job.status === "FAILED" ? (
          <div className="mt-6 rounded-sm border border-flame/40 bg-flame/10 p-4 text-sm leading-6 text-flame">
            <p>
              {job.errorMessage ||
                "Unable to generate a show plan with Qwen. Try again later."}
            </p>
            <Link
              to="/generate"
              className="mt-3 inline-block font-semibold text-flame underline decoration-flame/40 underline-offset-4 hover:text-flame/80"
            >
              Try again
            </Link>
          </div>
        ) : null}
      </div>
    </main>
  );
}

type AgentStageKey = "analyze" | "story" | "director" | "prompt" | "critic" | "editor";

function buildAgentStates(
  status: ShowrunnerJobStatus,
): Record<AgentStageKey, TimelineStageState> {
  if (status === "FAILED") {
    return {
      analyze: "pending",
      story: "pending",
      director: "pending",
      prompt: "pending",
      critic: "pending",
      editor: "pending",
    };
  }

  const currentIndex = STAGE_ORDER.indexOf(status);

  const entries = AGENT_STAGE_KEYS.map((key, stageIndex) => {
    const stageStatusIndex = stageIndex + 1;
    const state: TimelineStageState =
      currentIndex > stageStatusIndex
        ? "done"
        : currentIndex === stageStatusIndex
          ? "active"
          : "pending";

    return [key, state] as const;
  });

  return Object.fromEntries(entries) as Record<AgentStageKey, TimelineStageState>;
}
