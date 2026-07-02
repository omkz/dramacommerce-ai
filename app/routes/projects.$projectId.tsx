import { useState, type ReactNode } from "react";
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
  saveFinalVideo,
  type SavedProject,
} from "~/services/project-store.server";
import { queryWanVideoTask } from "~/services/wan-video.server";
import {
  enqueueVideoCreateJob,
  enqueueVideoStitchJob,
} from "~/services/video-queue.server";
import { requireUser } from "~/services/auth.server";
import {
  checkVideoCreateRateLimit,
  checkVideoStitchRateLimit,
} from "~/services/rate-limit.server";
import type { StoryboardScene } from "~/types/showrunner";

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

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const projectId = params.projectId;

  if (!projectId) {
    throw new Response("Project ID is required", { status: 400 });
  }

  const project = await getProject(projectId, user.id);

  if (!project) {
    throw new Response("Project not found", { status: 404 });
  }

  return project;
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const projectId = params.projectId;

  if (!projectId) {
    throw new Response("Project ID is required", { status: 400 });
  }

  const project = await getProject(projectId, user.id);

  if (!project) {
    throw new Response("Project not found", { status: 404 });
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "create-all-video-tasks") {
    const scenesToCreate = project.showPlan.storyboard.filter((scene) => {
      const job = project.videoJobs?.find((item) => item.scene === scene.scene);

      return !job || isFailedJobStatus(job.status);
    });

    if (scenesToCreate.length === 0) {
      return redirect(`/projects/${projectId}`);
    }

    const rateLimitResult = await checkVideoCreateRateLimit(
      user.id,
      scenesToCreate.length,
    );

    if (!rateLimitResult.allowed) {
      return { error: rateLimitResult.message };
    }

    const failures: number[] = [];

    for (const scene of scenesToCreate) {
      try {
        await createVideoJobForScene(projectId, user.id, scene);
      } catch (error) {
        console.error(`Failed to enqueue video job for scene ${scene.scene}:`, error);
        failures.push(scene.scene);
      }
    }

    if (failures.length > 0) {
      return {
        error: `Unable to queue video for scene(s) ${failures.join(", ")}. Check Redis/BullMQ configuration and try again.`,
      };
    }

    return redirect(`/projects/${projectId}`);
  }

  if (intent === "create-stitch-task") {
    const allScenesSucceeded =
      project.showPlan.storyboard.length > 0 &&
      project.showPlan.storyboard.every((scene) =>
        project.videoJobs?.some(
          (job) => job.scene === scene.scene && job.status === "SUCCEEDED",
        ),
      );

    if (!allScenesSucceeded) {
      throw new Response("All scenes must have a successful video before stitching", {
        status: 400,
      });
    }

    const rateLimitResult = await checkVideoStitchRateLimit(user.id);

    if (!rateLimitResult.allowed) {
      return { error: rateLimitResult.message };
    }

    try {
      const queueJobId = await enqueueVideoStitchJob({ projectId });
      const now = new Date().toISOString();

      await saveFinalVideo(projectId, user.id, {
        status: "QUEUED",
        queueJobId,
        createdAt: now,
        updatedAt: now,
      });

      return redirect(`/projects/${projectId}`);
    } catch (error) {
      console.error("Failed to enqueue stitch job:", error);

      return {
        error:
          "Unable to queue the final video. Check Redis/BullMQ configuration and try again.",
      };
    }
  }

  const sceneNumber = Number(formData.get("scene") || "1");

  const scene = project.showPlan.storyboard.find(
    (item) => item.scene === sceneNumber,
  );

  if (!scene) {
    throw new Response("Scene not found", { status: 404 });
  }

  if (intent === "create-video-task") {
    const rateLimitResult = await checkVideoCreateRateLimit(user.id);

    if (!rateLimitResult.allowed) {
      return { error: rateLimitResult.message };
    }

    try {
      await createVideoJobForScene(projectId, user.id, scene);

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

      await saveVideoJob(projectId, user.id, {
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

async function createVideoJobForScene(
  projectId: string,
  userId: string,
  scene: StoryboardScene,
): Promise<SavedProject> {
  const queueJobId = await enqueueVideoCreateJob({
    projectId,
    scene: scene.scene,
    prompt: scene.videoPrompt,
  });

  const now = new Date().toISOString();

  return saveVideoJob(projectId, userId, {
    scene: scene.scene,
    provider: "wan",
    queueJobId,
    status: "QUEUED",
    prompt: scene.videoPrompt,
    attempts: 0,
    nextPollAt: new Date(Date.now() + 30_000).toISOString(),
    createdAt: now,
    updatedAt: now,
  });
}

function getNextVideoPollAt(status: string): string | undefined {
  if (status === "QUEUED" || status === "PENDING" || status === "RUNNING" || status === "UNKNOWN") {
    return new Date(Date.now() + 30_000).toISOString();
  }

  return undefined;
}

function isFailedJobStatus(status: string): boolean {
  return status === "FAILED" || status === "CANCELED";
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "product-drama";
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
  const pendingIntent = navigation.formData?.get("intent");
  const pendingScene = navigation.formData?.get("scene");
  const isCreatingAllVideos = pendingIntent === "create-all-video-tasks";
  const isStitchingFinalVideo = pendingIntent === "create-stitch-task";
  const allScenesSucceeded =
    result.storyboard.length > 0 &&
    result.storyboard.every((scene) =>
      project.videoJobs?.some(
        (job) => job.scene === scene.scene && job.status === "SUCCEEDED",
      ),
    );

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

          {actionData?.error ? (
            <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm leading-6 text-red-100">
              {actionData.error}
            </p>
          ) : null}

          <ResultCard title="Final Drama Ad">
            <div className="space-y-4">
              <p className="text-sm leading-6 text-slate-300">
                Once all 5 scenes have a successful video, stitch them into one
                downloadable clip ready to post to TikTok, Reels, or Shorts.
              </p>

              {project.finalVideo?.status === "SUCCEEDED" && project.finalVideo.videoUrl ? (
                <video
                  src={project.finalVideo.videoUrl}
                  controls
                  className="w-full rounded-xl border border-white/10 bg-black"
                />
              ) : null}

              {project.finalVideo ? (
                <div className="rounded-xl border border-white/10 bg-slate-900 p-4">
                  <p className="text-sm text-slate-300">
                    Status:{" "}
                    <span className="font-semibold text-white">
                      {project.finalVideo.status}
                    </span>
                  </p>

                  <p className="mt-2 text-xs text-slate-500">
                    Last updated: {new Date(project.finalVideo.updatedAt).toLocaleString()}
                  </p>

                  {project.finalVideo.errorMessage ? (
                    <p className="mt-2 text-sm text-red-300">
                      {project.finalVideo.errorMessage}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                {allScenesSucceeded ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="create-stitch-task" />
                    <button
                      type="submit"
                      disabled={isStitchingFinalVideo}
                      className="rounded-xl bg-white px-5 py-3 font-semibold text-slate-950 transition hover:bg-slate-200"
                    >
                      {isStitchingFinalVideo
                        ? "Queuing final video..."
                        : project.finalVideo
                          ? "Re-stitch Final Video"
                          : "Stitch Final Video"}
                    </button>
                  </Form>
                ) : (
                  <p className="text-sm text-slate-500">
                    Generate a successful video for all 5 scenes below to unlock stitching.
                  </p>
                )}

                {project.finalVideo?.status === "SUCCEEDED" && project.finalVideo.videoUrl ? (
                  <a
                    href={project.finalVideo.videoUrl}
                    download={`${slugify(result.brief.productName)}-drama-ad.mp4`}
                    className="rounded-xl border border-white/15 px-5 py-3 font-semibold text-white transition hover:bg-white/10"
                  >
                    Download Final Video
                  </a>
                ) : null}
              </div>
            </div>
          </ResultCard>

          <ResultCard title="Storyboard">
            <div className="space-y-5">
              <Form method="post">
                <input type="hidden" name="intent" value="create-all-video-tasks" />
                <button
                  type="submit"
                  disabled={isCreatingAllVideos}
                  className="rounded-xl border border-white/15 px-5 py-3 font-semibold text-white transition hover:bg-white/10"
                >
                  {isCreatingAllVideos ? "Queuing all scenes..." : "Generate All Scenes"}
                </button>
              </Form>

              <div className="space-y-4">
                {result.storyboard.map((scene) => {
                  const videoJob = project.videoJobs?.find(
                    (job) => job.scene === scene.scene,
                  );
                  const isPendingForThisScene =
                    pendingScene === String(scene.scene);
                  const isCreatingVideo =
                    isPendingForThisScene && pendingIntent === "create-video-task";
                  const isRefreshingVideo =
                    isPendingForThisScene && pendingIntent === "refresh-video-task";
                  const canRetry = !videoJob || isFailedJobStatus(videoJob.status);

                  return (
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

                      {videoJob?.videoUrl ? (
                        <>
                          <video
                            src={videoJob.videoUrl}
                            controls
                            className="mt-3 w-full rounded-xl border border-white/10 bg-black"
                          />

                          <a
                            href={videoJob.videoUrl}
                            download={`${slugify(result.brief.productName)}-scene-${scene.scene}.mp4`}
                            className="mt-3 inline-block text-xs font-semibold text-slate-300 underline hover:text-white"
                          >
                            Download Scene {scene.scene}
                          </a>
                        </>
                      ) : null}

                      {videoJob ? (
                        <div className="mt-3 rounded-lg bg-white/5 p-3 text-xs text-slate-400">
                          <p>
                            Status:{" "}
                            <span className="font-semibold text-slate-200">
                              {videoJob.status}
                            </span>
                          </p>

                          <p className="mt-1">
                            Last updated: {new Date(videoJob.updatedAt).toLocaleString()}
                          </p>

                          <p className="mt-1">Poll attempts: {videoJob.attempts}</p>

                          {videoJob.errorMessage ? (
                            <p className="mt-1 text-red-300">{videoJob.errorMessage}</p>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="mt-3 flex flex-wrap gap-3">
                        {canRetry ? (
                          <Form method="post">
                            <input type="hidden" name="intent" value="create-video-task" />
                            <input type="hidden" name="scene" value={scene.scene} />
                            <button
                              type="submit"
                              disabled={isCreatingVideo}
                              className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-slate-200"
                            >
                              {isCreatingVideo
                                ? "Creating video task..."
                                : videoJob
                                  ? "Retry Video"
                                  : "Generate Video"}
                            </button>
                          </Form>
                        ) : (
                          <Form method="post">
                            <input type="hidden" name="intent" value="refresh-video-task" />
                            <input type="hidden" name="scene" value={scene.scene} />
                            <button
                              type="submit"
                              disabled={isRefreshingVideo}
                              className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                            >
                              {isRefreshingVideo ? "Refreshing status..." : "Refresh Status"}
                            </button>
                          </Form>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
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
            <CopyCaptionButton caption={result.caption} cta={result.cta} />
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

function CopyCaptionButton({ caption, cta }: { caption: string; cta: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(`${caption}\n\n${cta}`).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="mt-4 rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
    >
      {copied ? "Copied!" : "Copy Caption + CTA"}
    </button>
  );
}
