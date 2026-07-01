import type { ReactNode } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  getProject,
  saveVideoJob,
} from "~/services/project-store.server";
import { queryWanVideoTask } from "~/services/wan-video.server";
import { enqueueVideoCreateJob } from "~/services/video-queue.server";

const pipelineStages = [
  {
    name: "Story Agent",
    output: "Concept, hook, voice-over",
    detail: "Turns the product brief into a short-drama narrative spine.",
  },
  {
    name: "Director Agent",
    output: "Five-scene storyboard",
    detail: "Breaks the story into timed vertical-video scenes and shots.",
  },
  {
    name: "Prompt Agent",
    output: "Wan video prompts",
    detail: "Adds detailed text-to-video prompts for each directed scene.",
  },
  {
    name: "Editor Agent",
    output: "Timeline, caption, CTA",
    detail: "Prepares the edit plan and social publishing package.",
  },
];

export async function loader({ params }: LoaderFunctionArgs) {
  const projectId = params.projectId;

  if (!projectId) {
    throw new Response("Project ID is required", { status: 400 });
  }

  const project = await getProject(projectId);

  if (!project) {
    throw new Response("Project not found", { status: 404 });
  }

  return project;
}

export async function action({ request, params }: ActionFunctionArgs) {
  const projectId = params.projectId;

  if (!projectId) {
    throw new Response("Project ID is required", { status: 400 });
  }

  const project = await getProject(projectId);

  if (!project) {
    throw new Response("Project not found", { status: 404 });
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const sceneNumber = Number(formData.get("scene") || "1");

  const scene = project.showPlan.storyboard.find(
    (item) => item.scene === sceneNumber,
  );

  if (!scene) {
    throw new Response("Scene not found", { status: 404 });
  }

  if (intent === "create-video-task") {
    try {
      const now = new Date().toISOString();

      await saveVideoJob(projectId, {
        scene: scene.scene,
        provider: "wan",
        status: "QUEUED",
        prompt: scene.videoPrompt,
        attempts: 0,
        nextPollAt: new Date(Date.now() + 30_000).toISOString(),
        createdAt: now,
        updatedAt: now,
      });

      const queueJobId = await enqueueVideoCreateJob({
        projectId,
        scene: scene.scene,
        prompt: scene.videoPrompt,
      });

      await saveVideoJob(projectId, {
        scene: scene.scene,
        provider: "wan",
        queueJobId,
        status: "QUEUED",
        prompt: scene.videoPrompt,
        attempts: 0,
        nextPollAt: new Date(Date.now() + 30_000).toISOString(),
        createdAt: now,
        updatedAt: new Date().toISOString(),
      });

      return redirect(`/projects/${projectId}`);
    } catch (error) {
      console.error("Failed to enqueue video job:", error);

      return {
        error:
          "Unable to queue the video job. Check Redis/BullMQ configuration and try again.",
      };
    }
  }

  if (intent === "refresh-video-task") {
    const currentJob = project.videoJobs?.find(
      (job) => job.scene === scene.scene,
    );

    if (!currentJob) {
      throw new Response("Video task not found", { status: 404 });
    }

    if (!currentJob.taskId) {
      return redirect(`/projects/${projectId}`);
    }

    try {
      const task = await queryWanVideoTask(currentJob.taskId);

      await saveVideoJob(projectId, {
        ...currentJob,
        status: task.status,
        videoUrl: task.videoUrl,
        errorMessage: task.errorMessage,
        attempts: currentJob.attempts + 1,
        lastPolledAt: new Date().toISOString(),
        nextPollAt: getNextVideoPollAt(task.status),
        updatedAt: new Date().toISOString(),
      });

      return redirect(`/projects/${projectId}`);
    } catch (error) {
      console.error("Failed to refresh video task:", error);

      return {
        error:
          "Unable to refresh the Wan video task. Check provider configuration or try again later.",
      };
    }
  }

  throw new Response("Invalid intent", { status: 400 });
}

function getNextVideoPollAt(status: string): string | undefined {
  if (status === "QUEUED" || status === "PENDING" || status === "RUNNING" || status === "UNKNOWN") {
    return new Date(Date.now() + 30_000).toISOString();
  }

  return undefined;
}

export function meta() {
  return [
    { title: "Generated Project | DramaCommerce AI" },
    {
      name: "description",
      content: "Generated product drama ad plan.",
    },
  ];
}

export default function ProjectDetail() {
  const project = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const result = project.showPlan;
  const firstScene = result.storyboard[0];
  const firstSceneVideoJob = project.videoJobs?.find(
    (job) => job.scene === firstScene?.scene,
  );
  const pendingIntent = navigation.formData?.get("intent");
  const isCreatingVideo = pendingIntent === "create-video-task";
  const isRefreshingVideo = pendingIntent === "refresh-video-task";

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link to="/generate" className="text-sm text-slate-400 hover:text-white">
            ← Generate another product drama
          </Link>

          <p className="text-sm text-slate-500">
            Created at {new Date(project.createdAt).toLocaleString()}
          </p>
        </div>

        <section className="mt-10">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
            DramaCommerce AI
          </p>

          <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-5xl">
            {result.brief.productName}
          </h1>

          <p className="mt-4 max-w-2xl text-slate-300">
            AI-generated product drama ad plan for {result.brief.platform}.
          </p>

          {result.brief.imageUrl ? (
            <div className="mt-8 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
              <img
                src={result.brief.imageUrl}
                alt={result.brief.productName}
                className="max-h-[420px] w-full object-contain p-4"
              />
            </div>
          ) : null}
        </section>

        <section className="mt-8 space-y-5">
          <div
            className={
              result.source === "qwen"
                ? "rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-5"
                : "rounded-2xl border border-slate-400/20 bg-slate-400/10 p-5"
            }
          >
            <p
              className={
                result.source === "qwen"
                  ? "text-sm font-semibold text-emerald-200"
                  : "text-sm font-semibold text-slate-200"
              }
            >
              {result.source === "qwen"
                ? "Generated by Qwen Cloud."
                : "Legacy mock plan."}
            </p>

            <p
              className={
                result.source === "qwen"
                  ? "mt-2 text-sm text-emerald-100/80"
                  : "mt-2 text-sm text-slate-100/80"
              }
            >
              {result.source === "qwen"
                ? "The showrunner pipeline used Qwen to generate this product drama plan."
                : "This project was created before Qwen-only generation was enforced."}
            </p>
          </div>

          <ResultCard title="Qwen Showrunner Pipeline">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {pipelineStages.map((stage, index) => (
                <div
                  key={stage.name}
                  className="rounded-xl border border-white/10 bg-slate-900 p-4"
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-200">
                    Stage {index + 1}
                  </p>

                  <h3 className="mt-2 font-bold">{stage.name}</h3>

                  <p className="mt-2 text-sm font-medium text-slate-200">
                    {stage.output}
                  </p>

                  <p className="mt-3 text-sm leading-6 text-slate-400">
                    {stage.detail}
                  </p>
                </div>
              ))}
            </div>
          </ResultCard>

          <ResultCard title="Brief">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <SmallItem label="Product" value={result.brief.productName} />
              <SmallItem label="Image" value={result.brief.imageName} />
              <SmallItem label="Audience" value={result.brief.targetAudience} />
              <SmallItem label="Mood" value={result.brief.mood} />
              <SmallItem label="Platform" value={result.brief.platform} />
              <SmallItem label="Duration" value={result.brief.duration} />
            </div>
          </ResultCard>

          <ResultCard title="Story Concept">
            <p className="text-slate-300">{result.concept}</p>
          </ResultCard>

          <ResultCard title="Hook">
            <p className="text-2xl font-bold leading-snug">“{result.hook}”</p>
          </ResultCard>

          <ResultCard title="Voice-over">
            <p className="leading-7 text-slate-300">{result.voiceOver}</p>
          </ResultCard>

          {firstScene ? (
            <ResultCard title="Generated Video Clip">
              <div className="space-y-4">
                <p className="text-sm leading-6 text-slate-300">
                  Generate a real video clip from Scene 1 using Wan text-to-video.
                  This keeps generation cost predictable before queued multi-scene
                  generation is enabled.
                </p>

                {actionData?.error ? (
                  <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm leading-6 text-red-100">
                    {actionData.error}
                  </p>
                ) : null}

                {firstSceneVideoJob?.videoUrl ? (
                  <video
                    src={firstSceneVideoJob.videoUrl}
                    controls
                    className="w-full rounded-xl border border-white/10 bg-black"
                  />
                ) : null}

                {firstSceneVideoJob ? (
                  <div className="rounded-xl border border-white/10 bg-slate-900 p-4">
                    <p className="text-sm text-slate-300">
                      Status:{" "}
                      <span className="font-semibold text-white">
                        {firstSceneVideoJob.status}
                      </span>
                    </p>

                    {firstSceneVideoJob.taskId ? (
                      <p className="mt-2 break-all text-xs text-slate-500">
                        Task ID: {firstSceneVideoJob.taskId}
                      </p>
                    ) : null}

                    {firstSceneVideoJob.queueJobId ? (
                      <p className="mt-2 break-all text-xs text-slate-500">
                        Queue Job ID: {firstSceneVideoJob.queueJobId}
                      </p>
                    ) : null}

                    <p className="mt-2 text-xs text-slate-500">
                      Last updated: {new Date(firstSceneVideoJob.updatedAt).toLocaleString()}
                    </p>

                    <p className="mt-2 text-xs text-slate-500">
                      Poll attempts: {firstSceneVideoJob.attempts}
                    </p>

                    {firstSceneVideoJob.nextPollAt ? (
                      <p className="mt-2 text-xs text-slate-500">
                        Next worker poll:{" "}
                        {new Date(firstSceneVideoJob.nextPollAt).toLocaleString()}
                      </p>
                    ) : null}

                    {firstSceneVideoJob.errorMessage ? (
                      <p className="mt-2 text-sm text-red-300">
                        {firstSceneVideoJob.errorMessage}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-3">
                  {!firstSceneVideoJob ? (
                    <Form method="post">
                      <input type="hidden" name="intent" value="create-video-task" />
                      <input type="hidden" name="scene" value={firstScene.scene} />
                      <button
                        type="submit"
                        disabled={isCreatingVideo}
                        className="rounded-xl bg-white px-5 py-3 font-semibold text-slate-950 transition hover:bg-slate-200"
                      >
                        {isCreatingVideo
                          ? "Creating video task..."
                          : "Generate Video for Scene 1"}
                      </button>
                    </Form>
                  ) : (
                    <Form method="post">
                      <input type="hidden" name="intent" value="refresh-video-task" />
                      <input type="hidden" name="scene" value={firstScene.scene} />
                      <button
                        type="submit"
                        disabled={isRefreshingVideo}
                        className="rounded-xl border border-white/15 px-5 py-3 font-semibold text-white transition hover:bg-white/10"
                      >
                        {isRefreshingVideo
                          ? "Refreshing status..."
                          : "Refresh Video Status"}
                      </button>
                    </Form>
                  )}
                </div>

                <div className="rounded-xl bg-indigo-400/10 p-4 text-sm leading-6 text-indigo-100">
                  <span className="font-semibold text-white">Scene 1 prompt:</span>{" "}
                  {firstScene.videoPrompt}
                </div>
              </div>
            </ResultCard>
          ) : null}

          <ResultCard title="Storyboard">
            <div className="space-y-4">
              {result.storyboard.map((scene) => (
                <div
                  key={scene.scene}
                  className="rounded-xl border border-white/10 bg-slate-900 p-4"
                >
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Scene {scene.scene} · {scene.duration}
                  </p>

                  <h3 className="mt-1 font-bold">{scene.title}</h3>

                  <p className="mt-3 text-sm leading-6 text-slate-300">
                    {scene.visual}
                  </p>

                  <p className="mt-3 rounded-lg bg-white/5 p-3 text-sm text-slate-300">
                    <span className="font-semibold text-white">Voice-over:</span>{" "}
                    {scene.voiceOver}
                  </p>

                  <p className="mt-3 rounded-lg bg-indigo-400/10 p-3 text-sm leading-6 text-indigo-100">
                    <span className="font-semibold text-white">Video prompt:</span>{" "}
                    {scene.videoPrompt}
                  </p>
                </div>
              ))}
            </div>
          </ResultCard>

          <ResultCard title="Editing Timeline">
            <ol className="space-y-3">
              {result.timeline.map((item) => (
                <li
                  key={item}
                  className="rounded-xl border border-white/10 bg-slate-900 p-4 text-sm text-slate-300"
                >
                  {item}
                </li>
              ))}
            </ol>
          </ResultCard>

          <ResultCard title="Social Caption">
            <p className="leading-7 text-slate-300">{result.caption}</p>
            <p className="mt-4 text-lg font-bold">{result.cta}</p>
          </ResultCard>
        </section>
      </div>
    </main>
  );
}

function ResultCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <h2 className="text-xl font-bold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SmallItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-100">{value}</p>
    </div>
  );
}
