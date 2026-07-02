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
  deleteProject,
  saveVideoJob,
  saveFinalVideo,
  type SavedProject,
} from "~/services/project-store.server";
import { queryWanVideoTask } from "~/services/wan-video.server";
import { deleteUploadedFile } from "~/services/image-upload.server";
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

  if (intent === "delete-project") {
    const deleted = await deleteProject(projectId, user.id);

    if (deleted) {
      await deleteUploadedFile(deleted.showPlan.brief.imageUrl);
      await deleteUploadedFile(deleted.finalVideo?.videoUrl);
    }

    return redirect("/projects");
  }

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

    const promptOverride = String(formData.get("prompt") || "").trim();

    try {
      await createVideoJobForScene(
        projectId,
        user.id,
        scene,
        promptOverride || undefined,
      );

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
  promptOverride?: string,
): Promise<SavedProject> {
  const prompt = promptOverride || scene.videoPrompt;

  const queueJobId = await enqueueVideoCreateJob({
    projectId,
    scene: scene.scene,
    prompt,
  });

  const now = new Date().toISOString();

  return saveVideoJob(projectId, userId, {
    scene: scene.scene,
    provider: "wan",
    queueJobId,
    status: "QUEUED",
    prompt,
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

function isTerminalJobStatus(status: string): boolean {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELED";
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
  const isFinalVideoStale =
    project.finalVideo?.status === "SUCCEEDED" &&
    project.videoJobs?.some(
      (job) =>
        new Date(job.updatedAt).getTime() >
        new Date(project.finalVideo!.updatedAt).getTime(),
    );
  const isDeletingProject = pendingIntent === "delete-project";

  return (
    <main className="min-h-screen bg-ink px-6 py-10 text-bone">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link to="/generate" className="text-sm text-ash hover:text-bone">
            ← Start another production
          </Link>

          <div className="flex flex-wrap items-center gap-4">
            <p className="font-mono text-xs text-ash">
              Shot on {new Date(project.createdAt).toLocaleString()}
            </p>

            <Form
              method="post"
              onSubmit={(event) => {
                if (
                  !confirm(
                    "Delete this project? This permanently removes its videos and cannot be undone.",
                  )
                ) {
                  event.preventDefault();
                }
              }}
            >
              <input type="hidden" name="intent" value="delete-project" />
              <button
                type="submit"
                disabled={isDeletingProject}
                className="rounded border border-flame/30 px-3 py-1.5 text-xs font-semibold text-flame transition hover:bg-flame/10"
              >
                {isDeletingProject ? "Deleting..." : "Delete Project"}
              </button>
            </Form>
          </div>
        </div>

        <section className="mt-10">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-gold">
            Now Filming
          </p>

          <h1 className="mt-4 font-display text-4xl font-medium tracking-tight text-bone md:text-5xl">
            {result.brief.productName}
          </h1>

          <p className="mt-4 max-w-2xl text-ash">
            AI-generated product drama ad plan for {result.brief.platform}.
          </p>

          {result.brief.imageUrl ? (
            <div className="mt-8 overflow-hidden rounded-lg border border-paper/10 bg-panel">
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
                ? "rounded-lg border border-gold/25 bg-gold/10 p-5"
                : "rounded-lg border border-ash/25 bg-ash/10 p-5"
            }
          >
            <p
              className={
                result.source === "qwen"
                  ? "font-mono text-xs uppercase tracking-widest text-gold"
                  : "font-mono text-xs uppercase tracking-widest text-ash"
              }
            >
              {result.source === "qwen"
                ? "Generated by Qwen Cloud"
                : "Legacy mock plan"}
            </p>

            <p className="mt-2 text-sm text-bone/80">
              {result.source === "qwen"
                ? "The showrunner pipeline used Qwen to generate this product drama plan."
                : "This project was created before Qwen-only generation was enforced."}
            </p>
          </div>

          <ResultCard title="Production Crew" eyebrow="Credits">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {pipelineStages.map((stage, index) => (
                <div
                  key={stage.name}
                  className="rounded-sm border border-paper/10 bg-panel-raised p-4"
                >
                  <p className="font-mono text-xs text-gold">
                    Stage {index + 1}
                  </p>

                  <h3 className="mt-2 font-display font-medium text-bone">
                    {stage.name}
                  </h3>

                  <p className="mt-2 text-sm font-medium text-bone/80">
                    {stage.output}
                  </p>

                  <p className="mt-3 text-sm leading-6 text-ash">
                    {stage.detail}
                  </p>
                </div>
              ))}
            </div>
          </ResultCard>

          <ResultCard title="Brief" eyebrow="Call Sheet">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <SmallItem label="Product" value={result.brief.productName} />
              <SmallItem label="Image" value={result.brief.imageName} />
              <SmallItem label="Audience" value={result.brief.targetAudience} />
              <SmallItem label="Mood" value={result.brief.mood} />
              <SmallItem label="Platform" value={result.brief.platform} />
              <SmallItem label="Duration" value={result.brief.duration} />
            </div>
          </ResultCard>

          <ResultCard title="Story Concept" eyebrow="Logline">
            <p className="text-bone/80">{result.concept}</p>
          </ResultCard>

          <ResultCard title="Hook" eyebrow="Cold Open">
            <p className="font-display text-2xl font-medium leading-snug text-bone">
              “{result.hook}”
            </p>
          </ResultCard>

          <ResultCard title="Voice-over" eyebrow="Script">
            <p className="leading-7 text-bone/80">{result.voiceOver}</p>
          </ResultCard>

          {actionData?.error ? (
            <p className="rounded-lg border border-flame/30 bg-flame/10 p-4 text-sm leading-6 text-flame">
              {actionData.error}
            </p>
          ) : null}

          <ResultCard title="Final Drama Ad" eyebrow="Premiere" accent>
            <div className="space-y-4">
              <p className="text-sm leading-6 text-ash">
                Once all 5 scenes have a successful video, stitch them into one
                downloadable clip ready to post to TikTok, Reels, or Shorts.
              </p>

              {isFinalVideoStale ? (
                <p className="rounded-lg border border-gold/30 bg-gold/10 p-4 text-sm leading-6 text-gold">
                  A scene was regenerated after this video was stitched — re-stitch
                  to include the latest clips.
                </p>
              ) : null}

              {project.finalVideo?.status === "SUCCEEDED" && project.finalVideo.videoUrl ? (
                <video
                  src={project.finalVideo.videoUrl}
                  controls
                  className="w-full rounded-lg border border-paper/10 bg-black"
                />
              ) : null}

              {project.finalVideo ? (
                <div className="rounded-sm border border-paper/10 bg-panel-raised p-4">
                  <p className="text-sm text-ash">
                    Status:{" "}
                    <StatusTag status={project.finalVideo.status} />
                  </p>

                  <p className="mt-2 font-mono text-xs text-ash">
                    Last updated: {new Date(project.finalVideo.updatedAt).toLocaleString()}
                  </p>

                  {project.finalVideo.errorMessage ? (
                    <p className="mt-2 text-sm text-flame">
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
                      className="rounded bg-flame px-5 py-3 font-semibold text-bone transition hover:bg-flame/90"
                    >
                      {isStitchingFinalVideo
                        ? "Queuing final video..."
                        : project.finalVideo
                          ? "Re-stitch Final Video"
                          : "Stitch Final Video"}
                    </button>
                  </Form>
                ) : (
                  <p className="text-sm text-ash">
                    Generate a successful video for all 5 scenes below to unlock stitching.
                  </p>
                )}

                {project.finalVideo?.status === "SUCCEEDED" && project.finalVideo.videoUrl ? (
                  <a
                    href={project.finalVideo.videoUrl}
                    download={`${slugify(result.brief.productName)}-drama-ad.mp4`}
                    className="rounded border border-paper/15 px-5 py-3 font-semibold text-bone transition hover:bg-paper/10"
                  >
                    Download Final Video
                  </a>
                ) : null}
              </div>
            </div>
          </ResultCard>

          <ResultCard title="Storyboard" eyebrow="Reel">
            <div className="space-y-6">
              <Form method="post">
                <input type="hidden" name="intent" value="create-all-video-tasks" />
                <button
                  type="submit"
                  disabled={isCreatingAllVideos}
                  className="rounded border border-paper/15 px-5 py-3 font-semibold text-bone transition hover:bg-paper/10"
                >
                  {isCreatingAllVideos ? "Queuing all scenes..." : "Generate All Scenes"}
                </button>
              </Form>

              <div className="space-y-6">
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
                  const canRegenerate = !videoJob || isTerminalJobStatus(videoJob.status);
                  const currentPrompt = videoJob?.prompt ?? scene.videoPrompt;

                  return (
                    <div
                      key={scene.scene}
                      className="overflow-hidden rounded-lg border border-paper/10 bg-panel-raised"
                    >
                      <div className="sprockets sprockets-panel" aria-hidden />

                      <div className="p-5">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="rounded-full border border-gold/40 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-gold">
                            Scene {String(scene.scene).padStart(2, "0")}
                          </span>
                          <span className="font-mono text-xs text-ash">
                            {scene.duration}
                          </span>
                          {videoJob ? <StatusTag status={videoJob.status} /> : null}
                        </div>

                        <h3 className="mt-3 font-display text-xl font-medium text-bone">
                          {scene.title}
                        </h3>

                        <p className="mt-3 text-sm leading-6 text-ash">
                          {scene.visual}
                        </p>

                        <p className="mt-3 rounded-sm border border-paper/10 bg-panel p-3 text-sm text-bone/80">
                          <span className="font-semibold text-bone">Voice-over:</span>{" "}
                          {scene.voiceOver}
                        </p>

                        {videoJob?.videoUrl ? (
                          <>
                            <video
                              src={videoJob.videoUrl}
                              controls
                              className="mt-3 w-full rounded-lg border border-paper/10 bg-black"
                            />

                            <a
                              href={videoJob.videoUrl}
                              download={`${slugify(result.brief.productName)}-scene-${scene.scene}.mp4`}
                              className="mt-3 inline-block text-xs font-semibold text-ash underline decoration-paper/20 underline-offset-4 hover:text-bone"
                            >
                              Download Scene {scene.scene}
                            </a>
                          </>
                        ) : null}

                        {videoJob ? (
                          <div className="mt-3 rounded-sm border border-paper/10 bg-panel p-3 font-mono text-xs text-ash">
                            <p>
                              Last updated: {new Date(videoJob.updatedAt).toLocaleString()}
                            </p>

                            <p className="mt-1">Poll attempts: {videoJob.attempts}</p>

                            {videoJob.errorMessage ? (
                              <p className="mt-1 text-flame">{videoJob.errorMessage}</p>
                            ) : null}
                          </div>
                        ) : null}

                        {canRegenerate ? (
                          <Form method="post" className="mt-4">
                            <input type="hidden" name="intent" value="create-video-task" />
                            <input type="hidden" name="scene" value={scene.scene} />
                            <label
                              htmlFor={`prompt-${scene.scene}`}
                              className="block font-mono text-[11px] uppercase tracking-widest text-ash"
                            >
                              Video Prompt
                            </label>
                            <textarea
                              id={`prompt-${scene.scene}`}
                              name="prompt"
                              defaultValue={currentPrompt}
                              rows={3}
                              className="mt-2 w-full rounded-sm border border-paper/10 bg-ink p-3 font-mono text-xs leading-6 text-bone/80 outline-none focus:border-gold/50"
                            />
                            <button
                              type="submit"
                              disabled={isCreatingVideo}
                              className="mt-3 rounded bg-flame px-4 py-2 text-sm font-semibold text-bone transition hover:bg-flame/90"
                            >
                              {isCreatingVideo
                                ? "Creating video task..."
                                : videoJob
                                  ? "Regenerate Video"
                                  : "Generate Video"}
                            </button>
                          </Form>
                        ) : (
                          <>
                            <p className="mt-3 rounded-sm border border-paper/10 bg-ink p-3 font-mono text-xs leading-6 text-bone/70">
                              {currentPrompt}
                            </p>

                            <Form method="post" className="mt-3">
                              <input type="hidden" name="intent" value="refresh-video-task" />
                              <input type="hidden" name="scene" value={scene.scene} />
                              <button
                                type="submit"
                                disabled={isRefreshingVideo}
                                className="rounded border border-paper/15 px-4 py-2 text-sm font-semibold text-bone transition hover:bg-paper/10"
                              >
                                {isRefreshingVideo ? "Refreshing status..." : "Refresh Status"}
                              </button>
                            </Form>
                          </>
                        )}
                      </div>

                      <div className="sprockets sprockets-panel" aria-hidden />
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
                  className="rounded-sm border border-paper/10 bg-panel-raised p-4 font-mono text-sm text-bone/80"
                >
                  {item}
                </li>
              ))}
            </ol>
          </ResultCard>

          <ResultCard title="Social Caption" eyebrow="Press Release">
            <p className="leading-7 text-bone/80">{result.caption}</p>
            <p className="mt-4 font-display text-lg font-medium text-gold">
              {result.cta}
            </p>
            <CopyCaptionButton caption={result.caption} cta={result.cta} />
          </ResultCard>
        </section>
      </div>
    </main>
  );
}

function ResultCard({
  title,
  eyebrow,
  accent = false,
  children,
}: {
  title: string;
  eyebrow?: string;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={
        accent
          ? "rounded-lg border border-gold/25 bg-panel p-6"
          : "rounded-lg border border-paper/10 bg-panel p-6"
      }
    >
      {eyebrow ? (
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-gold">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="mt-1 font-display text-xl font-medium text-bone">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SmallItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-paper/10 bg-panel-raised p-4">
      <p className="font-mono text-[11px] uppercase tracking-widest text-ash">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-bone">{value}</p>
    </div>
  );
}

function StatusTag({ status }: { status: string }) {
  const isInFlight =
    status === "QUEUED" ||
    status === "PENDING" ||
    status === "RUNNING" ||
    status === "UNKNOWN";
  const isFailed = status === "FAILED" || status === "CANCELED";

  return (
    <span
      className={
        isFailed
          ? "inline-flex items-center gap-1.5 rounded-full border border-flame/40 px-2.5 py-1 font-mono text-[11px] uppercase tracking-widest text-flame"
          : status === "SUCCEEDED"
            ? "inline-flex items-center gap-1.5 rounded-full border border-gold/40 px-2.5 py-1 font-mono text-[11px] uppercase tracking-widest text-gold"
            : "inline-flex items-center gap-1.5 rounded-full border border-paper/20 px-2.5 py-1 font-mono text-[11px] uppercase tracking-widest text-ash"
      }
    >
      {isInFlight ? (
        <span className="tally-dot h-1.5 w-1.5 rounded-full bg-flame" aria-hidden />
      ) : null}
      {status}
    </span>
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
      className="mt-4 rounded border border-paper/15 px-4 py-2 text-sm font-semibold text-bone transition hover:bg-paper/10"
    >
      {copied ? "Copied!" : "Copy Caption + CTA"}
    </button>
  );
}
