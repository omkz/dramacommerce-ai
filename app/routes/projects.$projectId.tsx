import { useEffect, useState, type ReactNode } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useRevalidator,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  getProject,
  deleteProject,
  saveVideoJob,
  saveFinalVideo,
  updateShowPlan,
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
import { AgentTimeline, type TimelineStageState } from "~/components/agent-timeline";

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

  return { ...project, maxVoiceOverChars: getMaxVoiceOverChars() };
}

// Wan renders every scene at a fixed WAN_VIDEO_DURATION regardless of the
// scene's narrative pacing, so a voice-over line longer than that duration
// gets cut off mid-sentence when muxed (ffmpeg's -shortest caps the output
// at the video's length). 15 chars/sec is a conservative average spoken
// pace estimate — used for both the textarea's UX hint and the server-side
// check below, so they never disagree.
const SPOKEN_CHARS_PER_SECOND = 15;

function getMaxVoiceOverChars(): number {
  const durationSeconds = Number(process.env.WAN_VIDEO_DURATION || "5");

  return Math.max(20, Math.round(durationSeconds * SPOKEN_CHARS_PER_SECOND));
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
      await Promise.all([
        deleteUploadedFile(deleted.showPlan.brief.imageUrl),
        deleteUploadedFile(deleted.finalVideo?.videoUrl),
        ...(deleted.videoJobs ?? []).map((job) =>
          deleteUploadedFile(job.videoUrl),
        ),
      ]);
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
        await createVideoJobForScene(
          projectId,
          user.id,
          project.showPlan.brief.imageUrl,
          scene,
          project.showPlan.brief.showProductOverlay !== false,
          project.showPlan.brief.aspectRatio,
        );
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

  if (intent === "edit-story") {
    const concept = String(formData.get("concept") || "").trim();
    const hook = String(formData.get("hook") || "").trim();
    const voiceOver = String(formData.get("voiceOver") || "").trim();

    if (!concept || !hook || !voiceOver) {
      return { error: "Concept, hook, and voice-over can't be empty." };
    }

    await updateShowPlan(projectId, user.id, {
      ...project.showPlan,
      concept,
      hook,
      voiceOver,
    });

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
    const voiceOverOverride = String(formData.get("voiceOver") || "").trim();
    const maxVoiceOverChars = getMaxVoiceOverChars();

    if (voiceOverOverride.length > maxVoiceOverChars) {
      return {
        error: `Voice-over is too long for a ${process.env.WAN_VIDEO_DURATION || "5"}s scene (max ~${maxVoiceOverChars} characters) — it will get cut off mid-sentence. Shorten it and try again.`,
        scene: sceneNumber,
      };
    }

    try {
      await createVideoJobForScene(
        projectId,
        user.id,
        project.showPlan.brief.imageUrl,
        scene,
        project.showPlan.brief.showProductOverlay !== false,
        project.showPlan.brief.aspectRatio,
        promptOverride || undefined,
        voiceOverOverride || undefined,
      );

      return redirect(`/projects/${projectId}`);
    } catch (error) {
      console.error("Failed to enqueue video job:", error);

      return {
        error:
          "Unable to queue the video job. Check Redis/BullMQ configuration and try again.",
        scene: sceneNumber,
      };
    }
  }

  if (intent === "edit-scene") {
    const promptEdit = String(formData.get("prompt") || "").trim();
    const voiceOverEdit = String(formData.get("voiceOver") || "").trim();
    const maxVoiceOverChars = getMaxVoiceOverChars();

    if (!promptEdit || !voiceOverEdit) {
      return {
        error: "Prompt and voice-over can't be empty.",
        scene: sceneNumber,
      };
    }

    if (voiceOverEdit.length > maxVoiceOverChars) {
      return {
        error: `Voice-over is too long for a ${process.env.WAN_VIDEO_DURATION || "5"}s scene (max ~${maxVoiceOverChars} characters) — it will get cut off mid-sentence. Shorten it and try again.`,
        scene: sceneNumber,
      };
    }

    const currentJob = project.videoJobs?.find(
      (job) => job.scene === scene.scene,
    );

    if (currentJob) {
      await saveVideoJob(projectId, user.id, {
        ...currentJob,
        prompt: promptEdit,
        voiceOver: voiceOverEdit,
        updatedAt: new Date().toISOString(),
      });
    } else {
      const updatedStoryboard = project.showPlan.storyboard.map((item) =>
        item.scene === scene.scene
          ? { ...item, videoPrompt: promptEdit, voiceOver: voiceOverEdit }
          : item,
      );

      await updateShowPlan(projectId, user.id, {
        ...project.showPlan,
        storyboard: updatedStoryboard,
      });
    }

    return redirect(`/projects/${projectId}`);
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
        scene: sceneNumber,
      };
    }
  }

  throw new Response("Invalid intent", { status: 400 });
}

async function createVideoJobForScene(
  projectId: string,
  userId: string,
  productImageUrl: string | undefined,
  scene: StoryboardScene,
  showOverlay: boolean,
  aspectRatio: SavedProject["showPlan"]["brief"]["aspectRatio"],
  promptOverride?: string,
  voiceOverOverride?: string,
): Promise<SavedProject> {
  const prompt = promptOverride || scene.videoPrompt;
  const voiceOver = voiceOverOverride || scene.voiceOver;

  const queueJobId = await enqueueVideoCreateJob({
    projectId,
    scene: scene.scene,
    prompt,
    voiceOver,
    productImageUrl,
    useProductReference: scene.useProductReference,
    showOverlay,
    aspectRatio,
  });

  const now = new Date().toISOString();

  return saveVideoJob(projectId, userId, {
    scene: scene.scene,
    provider: "wan",
    queueJobId,
    status: "QUEUED",
    prompt,
    voiceOver,
    useProductReference: scene.useProductReference,
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

function isInFlightJobStatus(status: string): boolean {
  return (
    status === "QUEUED" ||
    status === "PENDING" ||
    status === "RUNNING" ||
    status === "UNKNOWN"
  );
}

function buildRenderStitchStates(
  project: SavedProject,
): { render: TimelineStageState; stitch: TimelineStageState } {
  const sceneCount = project.showPlan.storyboard.length;
  const videoJobs = project.videoJobs ?? [];

  let render: TimelineStageState = "pending";

  if (videoJobs.length > 0) {
    if (videoJobs.some((job) => isInFlightJobStatus(job.status))) {
      render = "active";
    } else if (
      sceneCount > 0 &&
      videoJobs.filter((job) => job.status === "SUCCEEDED").length === sceneCount
    ) {
      render = "done";
    } else if (videoJobs.some((job) => isFailedJobStatus(job.status))) {
      render = "failed";
    } else {
      render = "active";
    }
  }

  let stitch: TimelineStageState = "pending";

  if (project.finalVideo) {
    if (isInFlightJobStatus(project.finalVideo.status)) {
      stitch = "active";
    } else if (project.finalVideo.status === "SUCCEEDED") {
      stitch = "done";
    } else {
      stitch = "failed";
    }
  }

  return { render, stitch };
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
  const revalidator = useRevalidator();
  const result = project.showPlan;
  const pendingIntent = navigation.formData?.get("intent");
  const pendingScene = navigation.formData?.get("scene");
  const isCreatingAllVideos = pendingIntent === "create-all-video-tasks";
  const isStitchingFinalVideo = pendingIntent === "create-stitch-task";
  const isSavingStory = pendingIntent === "edit-story";
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
  const hasInFlightSceneVideos = project.videoJobs?.some((job) =>
    isInFlightJobStatus(job.status),
  );
  const hasInFlightFinalVideo = project.finalVideo
    ? isInFlightJobStatus(project.finalVideo.status)
    : false;
  const shouldAutoRefresh = hasInFlightSceneVideos || hasInFlightFinalVideo;
  const [editingScene, setEditingScene] = useState<number | null>(null);

  useEffect(() => {
    if (!shouldAutoRefresh) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (revalidator.state === "idle") {
        revalidator.revalidate();
      }
    }, 8_000);

    return () => window.clearInterval(intervalId);
  }, [revalidator, shouldAutoRefresh]);

  return (
    <main className="min-h-screen bg-ink px-6 py-10 text-bone">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link to="/generate" className="text-sm text-ash hover:text-bone">
            ← Create another ad
          </Link>

          <div className="flex flex-wrap items-center gap-4">
            {shouldAutoRefresh ? (
              <p className="inline-flex items-center gap-2 rounded-full border border-paper/15 px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-ash">
                <span className="tally-dot h-1.5 w-1.5 rounded-full bg-flame" aria-hidden />
                {revalidator.state === "loading" ? "Checking status" : "Auto-refresh on"}
              </p>
            ) : null}

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
            Product Ad Project
          </p>

          <h1 className="mt-4 font-display text-4xl font-medium tracking-tight text-bone md:text-5xl">
            {result.brief.productName}
          </h1>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ProjectStatusPill label={getProjectStatusLabel(project)} />
            <span className="font-mono text-xs text-ash">{result.brief.platform}</span>
            <span className="text-ash">·</span>
            <span className="font-mono text-xs text-ash">{result.brief.duration}</span>
            <span className="text-ash">·</span>
            <span className="font-mono text-xs text-ash">
              Created {new Date(project.createdAt).toLocaleDateString()}
            </span>
          </div>
        </section>

        {actionData?.error ? (
          <p
            role="alert"
            className="mt-8 rounded-lg border border-flame/30 bg-flame/10 p-4 text-sm leading-6 text-flame"
          >
            {actionData.error}
          </p>
        ) : null}

        <section className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="min-w-0 space-y-5">
            {result.analysis ? (
              <ResultCard title="Product Analysis" eyebrow="Vision">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <SmallItem label="Category" value={result.analysis.category} />
                  <SmallItem label="Colors" value={result.analysis.colors.join(", ")} />
                  <SmallItem label="Material" value={result.analysis.material} />
                  <SmallItem
                    label="Branding"
                    value={result.analysis.brandingVisible || "None visible"}
                  />
                  <SmallItem
                    label="Photo Quality"
                    value={
                      result.analysis.quality.charAt(0).toUpperCase() +
                      result.analysis.quality.slice(1)
                    }
                  />
                  <SmallItem
                    label="Product Reference"
                    value={result.analysis.canUseAsReference ? "Usable" : "Not usable"}
                  />
                </div>

                {result.analysis.issues.length > 0 ? (
                  <p className="mt-4 text-sm leading-6 text-ash">
                    <span className="font-semibold text-bone">Issues noted: </span>
                    {result.analysis.issues.join(", ")}
                  </p>
                ) : null}
              </ResultCard>
            ) : null}

            <ResultCard title="Story & Voice-over" eyebrow="Editing">
              <Form method="post" className="space-y-4">
                <input type="hidden" name="intent" value="edit-story" />

                <div>
                  <label
                    htmlFor="concept"
                    className="block font-mono text-[11px] uppercase tracking-widest text-ash"
                  >
                    Concept
                  </label>
                  <textarea
                    id="concept"
                    name="concept"
                    defaultValue={result.concept}
                    rows={2}
                    className="mt-2 w-full resize-y rounded-sm border border-paper/10 bg-ink p-3 text-sm leading-6 text-bone/80 outline-none focus:border-gold/50"
                  />
                </div>

                <div>
                  <label
                    htmlFor="hook"
                    className="block font-mono text-[11px] uppercase tracking-widest text-ash"
                  >
                    Hook
                  </label>
                  <textarea
                    id="hook"
                    name="hook"
                    defaultValue={result.hook}
                    rows={2}
                    className="mt-2 w-full resize-y rounded-sm border border-paper/10 bg-ink p-3 text-sm leading-6 text-bone/80 outline-none focus:border-gold/50"
                  />
                </div>

                <div>
                  <label
                    htmlFor="storyVoiceOver"
                    className="block font-mono text-[11px] uppercase tracking-widest text-ash"
                  >
                    Voice-over
                  </label>
                  <textarea
                    id="storyVoiceOver"
                    name="voiceOver"
                    defaultValue={result.voiceOver}
                    rows={3}
                    className="mt-2 w-full resize-y rounded-sm border border-paper/10 bg-ink p-3 text-sm leading-6 text-bone/80 outline-none focus:border-gold/50"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSavingStory}
                  className="rounded border border-paper/15 px-4 py-2 text-sm font-semibold text-bone transition hover:bg-paper/10"
                >
                  {isSavingStory ? "Saving..." : "Save Changes"}
                </button>
              </Form>
            </ResultCard>

            <ResultCard title="Storyboard" eyebrow="5 Scenes">
              <div className="flex gap-3 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible">
                {result.storyboard.map((scene) => (
                  <div
                    key={scene.scene}
                    className="w-44 shrink-0 rounded-sm border border-paper/10 bg-panel-raised p-4 lg:w-auto lg:min-w-[180px] lg:flex-1"
                  >
                    <span className="rounded-full border border-gold/40 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-gold">
                      Scene {String(scene.scene).padStart(2, "0")}
                    </span>
                    <h3 className="mt-3 font-display text-base font-medium text-bone">
                      {scene.title}
                    </h3>
                    <p className="mt-1 font-mono text-[11px] text-ash">{scene.duration}</p>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-ash">
                      {scene.visual}
                    </p>
                  </div>
                ))}
              </div>
            </ResultCard>

            <ResultCard title="Scene Prompts & Voice-over" eyebrow="Script">
              <div className="space-y-3">
                {result.storyboard.map((scene) => {
                  const videoJob = project.videoJobs?.find(
                    (job) => job.scene === scene.scene,
                  );
                  const currentPrompt = videoJob?.prompt ?? scene.videoPrompt;
                  const currentVoiceOver = videoJob?.voiceOver ?? scene.voiceOver;
                  const isEditingThisScene = editingScene === scene.scene;
                  const isPendingForThisScene =
                    pendingScene === String(scene.scene);
                  const isSavingEdit =
                    isPendingForThisScene && pendingIntent === "edit-scene";
                  const sceneActionError =
                    actionData?.scene === scene.scene ? actionData.error : undefined;

                  return (
                    <div
                      key={scene.scene}
                      className="rounded-sm border border-paper/10 bg-panel-raised p-4"
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="rounded-full border border-gold/40 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-gold">
                          Scene {String(scene.scene).padStart(2, "0")}
                        </span>
                        {videoJob ? <StatusTag status={videoJob.status} /> : null}
                      </div>

                      {sceneActionError ? (
                        <p
                          role="alert"
                          className="mt-3 rounded-lg border border-flame/30 bg-flame/10 p-3 text-sm leading-6 text-flame"
                        >
                          {sceneActionError}
                        </p>
                      ) : null}

                      {isEditingThisScene ? (
                        <Form method="post" className="mt-3">
                          <input type="hidden" name="intent" value="edit-scene" />
                          <input type="hidden" name="scene" value={scene.scene} />

                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <label
                              htmlFor={`voiceOver-${scene.scene}`}
                              className="block font-mono text-[11px] uppercase tracking-widest text-ash"
                            >
                              Voice-over
                            </label>
                            <span className="font-mono text-[11px] text-ash">
                              Max {project.maxVoiceOverChars} chars
                            </span>
                          </div>
                          <textarea
                            id={`voiceOver-${scene.scene}`}
                            name="voiceOver"
                            defaultValue={currentVoiceOver}
                            maxLength={project.maxVoiceOverChars}
                            rows={3}
                            className="mt-2 w-full resize-y rounded-sm border border-paper/10 bg-ink p-3 text-sm leading-6 text-bone/80 outline-none focus:border-gold/50"
                          />

                          <label
                            htmlFor={`prompt-${scene.scene}`}
                            className="mt-4 block font-mono text-[11px] uppercase tracking-widest text-ash"
                          >
                            Video Prompt
                          </label>
                          <textarea
                            id={`prompt-${scene.scene}`}
                            name="prompt"
                            defaultValue={currentPrompt}
                            rows={6}
                            className="mt-2 w-full resize-y rounded-sm border border-paper/10 bg-ink p-3 font-mono text-xs leading-6 text-bone/80 outline-none focus:border-gold/50"
                          />

                          <div className="mt-3 flex flex-wrap gap-3">
                            <button
                              type="submit"
                              disabled={isSavingEdit}
                              className="rounded border border-paper/15 px-4 py-2 text-sm font-semibold text-bone transition hover:bg-paper/10"
                            >
                              {isSavingEdit ? "Saving..." : "Save Edit"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingScene(null)}
                              className="rounded px-4 py-2 text-sm font-semibold text-ash transition hover:text-bone"
                            >
                              Cancel
                            </button>
                          </div>
                        </Form>
                      ) : (
                        <div className="mt-3">
                          <p className="line-clamp-2 text-sm text-bone/80">
                            <span className="font-semibold text-bone">Voice-over: </span>
                            {currentVoiceOver}
                          </p>
                          <p className="mt-2 line-clamp-2 font-mono text-xs leading-5 text-ash">
                            {currentPrompt}
                          </p>
                          <button
                            type="button"
                            onClick={() => setEditingScene(scene.scene)}
                            className="mt-3 rounded border border-paper/15 px-4 py-2 text-sm font-semibold text-bone transition hover:bg-paper/10"
                          >
                            Edit
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ResultCard>

            <ResultCard title="Generated Videos" eyebrow="Render">
              <div className="space-y-4">
                <Form method="post">
                  <input type="hidden" name="intent" value="create-all-video-tasks" />
                  <button
                    type="submit"
                    disabled={isCreatingAllVideos}
                    className="rounded border border-paper/15 px-5 py-3 font-semibold text-bone transition hover:bg-paper/10"
                  >
                    {isCreatingAllVideos ? "Queuing scene videos..." : "Generate 5 Scene Videos"}
                  </button>
                </Form>

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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

                    return (
                      <div
                        key={scene.scene}
                        className="rounded-lg border border-paper/10 bg-panel-raised p-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-gold/40 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-gold">
                            Scene {String(scene.scene).padStart(2, "0")}
                          </span>
                          {videoJob ? <StatusTag status={videoJob.status} /> : null}
                        </div>

                        {videoJob?.videoUrl ? (
                          <>
                            <div
                              className={`mt-3 ${getVideoFrameClassName(result.brief.aspectRatio, "grid")}`}
                            >
                              <video
                                src={videoJob.videoUrl}
                                controls
                                className="h-full w-full rounded-md bg-black object-contain"
                              />
                            </div>
                            <a
                              href={videoJob.videoUrl}
                              download={`${slugify(result.brief.productName)}-scene-${scene.scene}.mp4`}
                              className="mt-2 inline-block text-xs font-semibold text-ash underline decoration-paper/20 underline-offset-4 hover:text-bone"
                            >
                              Download Scene {scene.scene}
                            </a>
                          </>
                        ) : (
                          <div
                            className={`mt-3 flex items-center justify-center rounded-md border border-dashed border-paper/15 bg-ink ${getVideoFrameClassName(result.brief.aspectRatio, "grid")}`}
                          >
                            <p className="font-mono text-[11px] uppercase tracking-widest text-ash">
                              {videoJob ? videoJob.status : "Not rendered"}
                            </p>
                          </div>
                        )}

                        {videoJob?.errorMessage ? (
                          <p className="mt-2 text-sm text-flame">{videoJob.errorMessage}</p>
                        ) : null}

                        <div className="mt-3">
                          {canRegenerate ? (
                            <Form method="post">
                              <input type="hidden" name="intent" value="create-video-task" />
                              <input type="hidden" name="scene" value={scene.scene} />
                              <input
                                type="hidden"
                                name="prompt"
                                value={videoJob?.prompt ?? scene.videoPrompt}
                              />
                              <input
                                type="hidden"
                                name="voiceOver"
                                value={videoJob?.voiceOver ?? scene.voiceOver}
                              />
                              <button
                                type="submit"
                                disabled={isCreatingVideo}
                                className="w-full rounded bg-flame px-4 py-3 text-sm font-semibold text-bone transition hover:bg-flame/90"
                              >
                                {isCreatingVideo
                                  ? "Queuing..."
                                  : videoJob
                                    ? "Regenerate Scene Video"
                                    : "Generate Scene Video"}
                              </button>
                            </Form>
                          ) : (
                            <Form method="post">
                              <input type="hidden" name="intent" value="refresh-video-task" />
                              <input type="hidden" name="scene" value={scene.scene} />
                              <button
                                type="submit"
                                disabled={isRefreshingVideo}
                                className="w-full rounded border border-paper/15 px-4 py-2 text-sm font-semibold text-bone transition hover:bg-paper/10"
                              >
                                {isRefreshingVideo ? "Checking..." : "Check Wan Status"}
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
          </div>

          <aside className="min-w-0 space-y-5 lg:sticky lg:top-6">
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

            <ResultCard title="Final Product Drama Ad" eyebrow="Output" accent>
              <div className="space-y-4">
                <p className="text-sm leading-6 text-ash">
                  Once all 5 scene videos succeed, stitch them into one
                  downloadable ad ready for TikTok, Reels, or Shorts.
                </p>

                {isFinalVideoStale ? (
                  <p className="rounded-lg border border-gold/30 bg-gold/10 p-4 text-sm leading-6 text-gold">
                    A scene was regenerated after this video was stitched — re-stitch
                    to include the latest clips.
                  </p>
                ) : null}

                {project.finalVideo?.status === "SUCCEEDED" && project.finalVideo.videoUrl ? (
                  <div className="rounded-lg border border-paper/10 bg-panel-raised p-4">
                    <div className={getVideoFrameClassName(result.brief.aspectRatio, "sidebar")}>
                      <video
                        src={project.finalVideo.videoUrl}
                        controls
                        className="h-full w-full rounded-md bg-black object-contain"
                      />
                    </div>
                  </div>
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

                    {isInFlightJobStatus(project.finalVideo.status) ? (
                      <p className="mt-2 text-sm text-ash">
                        This page checks final video progress automatically.
                      </p>
                    ) : null}

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
                          ? "Queuing final ad..."
                          : project.finalVideo
                            ? "Re-stitch Final Ad"
                            : "Stitch Final Ad"}
                      </button>
                    </Form>
                  ) : (
                    <p className="text-sm text-ash">
                      Generate successful videos for all 5 scenes to unlock final stitching.
                    </p>
                  )}

                  {project.finalVideo?.status === "SUCCEEDED" && project.finalVideo.videoUrl ? (
                    <a
                      href={project.finalVideo.videoUrl}
                      download={`${slugify(result.brief.productName)}-drama-ad.mp4`}
                      className="rounded border border-paper/15 px-5 py-3 font-semibold text-bone transition hover:bg-paper/10"
                    >
                      Download Final Ad
                    </a>
                  ) : null}
                </div>
              </div>
            </ResultCard>

            <ResultCard title="Production Timeline" eyebrow="Credits">
              <AgentTimeline
                states={{
                  analyze: "done",
                  story: "done",
                  director: "done",
                  prompt: "done",
                  critic: "done",
                  editor: "done",
                  ...buildRenderStitchStates(project),
                }}
              />
            </ResultCard>

            <ResultCard title="Project Info" eyebrow="Inputs">
              {result.brief.imageUrl ? (
                <div className="mb-4 overflow-hidden rounded-sm border border-paper/10 bg-panel">
                  <img
                    src={result.brief.imageUrl}
                    alt={result.brief.productName}
                    className="h-32 w-full object-contain p-2"
                  />
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <SmallItem label="Product" value={result.brief.productName} />
                <SmallItem label="Image" value={result.brief.imageName} />
                <SmallItem label="Audience" value={result.brief.targetAudience} />
                <SmallItem label="Mood" value={result.brief.mood} />
                <SmallItem label="Platform" value={result.brief.platform} />
                <SmallItem label="Duration" value={result.brief.duration} />
                <SmallItem
                  label="Aspect Ratio"
                  value={getAspectRatioLabel(result.brief.aspectRatio)}
                />
                <SmallItem
                  label="Reference Mode"
                  value={getProductReferenceModeLabel(
                    result.brief.productReferenceMode,
                  )}
                />
              </div>

              {result.brief.productDescription ||
              result.brief.keySellingPoints ||
              result.brief.offer ? (
                <div className="mt-4 grid gap-3">
                  {result.brief.productDescription ? (
                    <SmallItem
                      label="Description"
                      value={result.brief.productDescription}
                    />
                  ) : null}

                  {result.brief.keySellingPoints ? (
                    <SmallItem
                      label="Selling Points"
                      value={result.brief.keySellingPoints}
                    />
                  ) : null}

                  {result.brief.offer ? (
                    <SmallItem label="Offer" value={result.brief.offer} />
                  ) : null}
                </div>
              ) : null}
            </ResultCard>
          </aside>
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

function getProductReferenceModeLabel(mode: string | undefined): string {
  if (mode === "force") return "Use as packshot";
  if (mode === "disable") return "Disabled";
  return "Auto";
}

function getAspectRatioLabel(aspectRatio: string | undefined): string {
  if (aspectRatio === "1:1") return "1:1 Instagram Feed";
  if (aspectRatio === "16:9") return "16:9 YouTube";
  return "9:16 TikTok/Reels/Shorts";
}

function getVideoFrameClassName(
  aspectRatio: string | undefined,
  size: "sidebar" | "grid",
): string {
  const aspectClass =
    aspectRatio === "1:1"
      ? "aspect-square"
      : aspectRatio === "16:9"
        ? "aspect-video"
        : "aspect-9/16";

  const maxWidth =
    size === "sidebar"
      ? aspectRatio === "1:1"
        ? "max-w-[360px]"
        : aspectRatio === "16:9"
          ? "max-w-[380px]"
          : "max-w-[300px]"
      : aspectRatio === "1:1"
        ? "max-w-[320px]"
        : aspectRatio === "16:9"
          ? "max-w-[360px]"
          : "max-w-[260px]";

  return `mx-auto ${aspectClass} w-full ${maxWidth} overflow-hidden rounded-md bg-black`;
}

function getProjectStatusLabel(project: SavedProject): string {
  const hasFailed =
    project.videoJobs?.some((job) => isFailedJobStatus(job.status)) ||
    project.finalVideo?.status === "FAILED" ||
    project.finalVideo?.status === "CANCELED" ||
    false;

  if (hasFailed) return "Failed";

  const hasInFlight =
    project.videoJobs?.some((job) => isInFlightJobStatus(job.status)) ||
    (project.finalVideo ? isInFlightJobStatus(project.finalVideo.status) : false);

  if (hasInFlight) return "Rendering";
  if (project.finalVideo?.status === "SUCCEEDED") return "Completed";

  return "Draft";
}

function ProjectStatusPill({ label }: { label: string }) {
  const isFailed = label === "Failed";
  const isActive = label === "Rendering";
  const isReady = label === "Completed";

  return (
    <span
      className={
        isFailed
          ? "rounded-full border border-flame/40 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-flame"
          : isActive
            ? "rounded-full border border-gold/30 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-gold"
            : isReady
              ? "rounded-full border border-gold/40 bg-gold/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-gold"
              : "rounded-full border border-paper/20 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-ash"
      }
    >
      {label}
    </span>
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
