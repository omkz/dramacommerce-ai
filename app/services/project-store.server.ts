import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { finalVideos, projects, showrunnerJobs, videoJobs } from "~/db/schema";
import { db } from "~/services/db.server";
import { insertOutboxEvent } from "~/services/outbox.server";
import {
  SHOWRUNNER_QUEUE_NAME,
  type ShowrunnerGenerateJobData,
} from "~/services/showrunner-queue.server";
import {
  VIDEO_QUEUE_NAME,
  type VideoCreateJobData,
  type VideoStitchJobData,
} from "~/services/video-queue.server";
import { getMediaStorage } from "~/services/storage/media-storage.server";
import type { ProductBrief, ShowPlan } from "~/types/showrunner";
import {
  parseShowrunnerJobStatus,
  type ShowrunnerJobStatus,
} from "~/types/showrunner-status";
import {
  parseVideoGenerationStatus,
  type VideoGenerationStatus,
} from "~/types/video-status";

// Statuses that mean "there is already active work in flight for this
// scene/stitch" — createVideoGenerationWithOutbox/createStitchGenerationWithOutbox
// refuse to start a new generation while the current one is in one of these,
// so a duplicate HTTP submission is a no-op instead of duplicate provider work.
const ACTIVE_VIDEO_STATUSES: VideoGenerationStatus[] = [
  "QUEUED",
  "PENDING",
  "RUNNING",
  "UNKNOWN",
];

export type VideoGenerationJob = {
  scene: number;
  taskId?: string;
  queueJobId?: string;
  provider: "wan";
  status: VideoGenerationStatus;
  generationId: string;
  prompt: string;
  voiceOver?: string;
  useProductReference?: boolean;
  attempts: number;
  videoUrl?: string;
  errorMessage?: string;
  lastPolledAt?: string;
  nextPollAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type FinalVideo = {
  status: VideoGenerationStatus;
  videoUrl?: string;
  errorMessage?: string;
  queueJobId?: string;
  stitchGenerationId?: string;
  createdAt: string;
  updatedAt: string;
};

export type SavedProject = {
  id: string;
  createdAt: string;
  showPlan: ShowPlan;
  videoJobs?: VideoGenerationJob[];
  finalVideo?: FinalVideo;
};

export type ShowrunnerJob = {
  id: string;
  userId: string;
  brief: ProductBrief;
  status: ShowrunnerJobStatus;
  errorMessage?: string;
  projectId?: string;
  createdAt: string;
  updatedAt: string;
};

// idempotencyToken is server-generated in the /projects/new loader and
// round-tripped through a hidden form field — it becomes the
// showrunner_jobs.id itself (not a separate column), so a duplicate POST
// with the same token (browser retry, back-button resubmit) hits the id's
// primary-key conflict and is treated as a replay of the original
// submission instead of a new job. Insert + outbox event commit atomically:
// either both exist or neither does, so a dispatcher never has to guess
// whether a showrunner_jobs row without a matching outbox event was really
// enqueued.
export async function createShowrunnerJobWithOutbox(
  idempotencyToken: string,
  userId: string,
  brief: ProductBrief,
): Promise<{ job: ShowrunnerJob; created: boolean }> {
  return db.transaction(async (tx) => {
    const now = new Date();

    const [inserted] = await tx
      .insert(showrunnerJobs)
      .values({
        id: idempotencyToken,
        userId,
        briefJson: brief,
        status: "QUEUED",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: showrunnerJobs.id })
      .returning();

    if (!inserted) {
      const [existing] = await tx
        .select()
        .from(showrunnerJobs)
        .where(
          and(eq(showrunnerJobs.id, idempotencyToken), eq(showrunnerJobs.userId, userId)),
        );

      if (!existing) {
        // The id collided with a row owned by a different user — an
        // effectively impossible UUID collision, but fail closed rather
        // than silently returning someone else's job.
        throw new Error("Idempotency token conflict.");
      }

      return { job: rowToShowrunnerJob(existing), created: false };
    }

    const payload: ShowrunnerGenerateJobData = {
      showrunnerJobId: idempotencyToken,
      userId,
    };

    await insertOutboxEvent(tx, {
      queue: SHOWRUNNER_QUEUE_NAME,
      jobName: "showrunner.generate",
      jobKey: `showrunner-generate_${idempotencyToken}`,
      payload,
    });

    return { job: rowToShowrunnerJob(inserted), created: true };
  });
}

export async function getShowrunnerJob(
  id: string,
  userId: string,
): Promise<ShowrunnerJob | null> {
  const rows = await db
    .select()
    .from(showrunnerJobs)
    .where(and(eq(showrunnerJobs.id, id), eq(showrunnerJobs.userId, userId)));

  return rows[0] ? rowToShowrunnerJob(rows[0]) : null;
}

export async function updateShowrunnerJob(
  id: string,
  update: Partial<Pick<ShowrunnerJob, "status" | "errorMessage" | "projectId">>,
): Promise<void> {
  await db
    .update(showrunnerJobs)
    .set({ ...update, updatedAt: new Date() })
    .where(eq(showrunnerJobs.id, id));
}

function rowToShowrunnerJob(row: typeof showrunnerJobs.$inferSelect): ShowrunnerJob {
  return {
    id: row.id,
    userId: row.userId,
    brief: row.briefJson,
    status: parseShowrunnerJobStatus(row.status),
    errorMessage: row.errorMessage ?? undefined,
    projectId: row.projectId ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Creating the project row and marking the showrunner job SUCCEEDED (with
// its projectId) commit in one transaction — otherwise a worker crash
// between the two would leave a job that *looks* incomplete (status still
// mid-pipeline, no projectId recorded anywhere) despite a project already
// having been created, and a naive retry would generate a second project
// for the same logical job. See scripts/showrunner-worker.mts's
// SUCCEEDED-short-circuit at the top of runShowrunnerJob for the other half
// of this guarantee (an already-completed job is never reprocessed at all).
export async function saveProjectAndCompleteShowrunnerJob(
  showrunnerJobId: string,
  showPlan: ShowPlan,
  userId: string,
): Promise<SavedProject> {
  return db.transaction(async (tx) => {
    const project: SavedProject = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      showPlan,
    };

    await tx.insert(projects).values({
      id: project.id,
      userId,
      createdAt: new Date(project.createdAt),
      showPlan: project.showPlan,
    });

    await tx
      .update(showrunnerJobs)
      .set({ status: "SUCCEEDED", projectId: project.id, updatedAt: new Date() })
      .where(eq(showrunnerJobs.id, showrunnerJobId));

    return project;
  });
}

export async function listProjects(userId: string): Promise<SavedProject[]> {
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.createdAt));

  if (rows.length === 0) {
    return [];
  }

  const projectIds = rows.map((row) => row.id);
  const [videoJobRows, finalVideoRows] = await Promise.all([
    db
      .select()
      .from(videoJobs)
      .where(inArray(videoJobs.projectId, projectIds))
      .orderBy(videoJobs.projectId, videoJobs.scene),
    db
      .select()
      .from(finalVideos)
      .where(inArray(finalVideos.projectId, projectIds)),
  ]);
  const videoJobsByProjectId = groupVideoJobsByProjectId(videoJobRows);
  const finalVideosByProjectId = new Map(
    finalVideoRows.map((row) => [row.projectId, rowToFinalVideo(row)]),
  );

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    showPlan: row.showPlan,
    videoJobs: videoJobsByProjectId.get(row.id) ?? [],
    finalVideo: finalVideosByProjectId.get(row.id),
  }));
}

export async function getProject(
  id: string,
  userId: string,
): Promise<SavedProject | null> {
  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));

  if (!rows[0]) {
    return null;
  }

  return rowToProject(rows[0]);
}

// getProject/listProjects (above) return raw storage references (keys, or
// legacy "/uploads/..." paths) — correct for deletion and for feeding the
// Analyze Agent's storage read. Routes that render project data (img/video
// src) should use these *ForDisplay variants instead, which resolve every
// media reference to a browser-usable URL (a signed OSS URL when
// MEDIA_STORAGE_DRIVER=oss) right before returning — never persisted.
export async function getProjectForDisplay(
  id: string,
  userId: string,
): Promise<SavedProject | null> {
  const project = await getProject(id, userId);

  return project ? resolveProjectMediaUrls(project) : null;
}

export async function listProjectsForDisplay(userId: string): Promise<SavedProject[]> {
  const projectsList = await listProjects(userId);

  return Promise.all(projectsList.map(resolveProjectMediaUrls));
}

async function resolveProjectMediaUrls(project: SavedProject): Promise<SavedProject> {
  const storage = getMediaStorage();

  const resolveRef = async (ref: string | undefined): Promise<string | undefined> => {
    if (!ref) {
      return undefined;
    }

    try {
      return await storage.resolveUrl(ref);
    } catch (error) {
      console.error(`Failed to resolve media URL for ref "${ref}":`, error);
      return undefined;
    }
  };

  const [imageUrl, resolvedVideoJobs, finalVideoUrl] = await Promise.all([
    resolveRef(project.showPlan.brief.imageUrl),
    Promise.all(
      (project.videoJobs ?? []).map(async (job) => ({
        ...job,
        videoUrl: await resolveRef(job.videoUrl),
      })),
    ),
    resolveRef(project.finalVideo?.videoUrl),
  ]);

  return {
    ...project,
    showPlan: {
      ...project.showPlan,
      brief: {
        ...project.showPlan.brief,
        imageUrl,
      },
    },
    videoJobs: resolvedVideoJobs,
    finalVideo: project.finalVideo
      ? { ...project.finalVideo, videoUrl: finalVideoUrl }
      : undefined,
  };
}

export async function deleteProject(
  id: string,
  userId: string,
): Promise<SavedProject | null> {
  const project = await getProject(id, userId);

  if (!project) {
    return null;
  }

  await db
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));

  return project;
}

export async function saveVideoJob(
  projectId: string,
  userId: string,
  job: VideoGenerationJob,
): Promise<SavedProject> {
  await db
    .insert(videoJobs)
    .values({
      projectId,
      scene: job.scene,
      provider: job.provider,
      queueJobId: job.queueJobId,
      taskId: job.taskId,
      status: job.status,
      generationId: job.generationId,
      prompt: job.prompt,
      voiceOver: job.voiceOver,
      useProductReference: job.useProductReference ?? false,
      attempts: job.attempts,
      videoUrl: job.videoUrl,
      errorMessage: job.errorMessage,
      lastPolledAt: job.lastPolledAt ? new Date(job.lastPolledAt) : undefined,
      nextPollAt: job.nextPollAt ? new Date(job.nextPollAt) : undefined,
      createdAt: new Date(job.createdAt),
      updatedAt: new Date(job.updatedAt),
    })
    .onConflictDoUpdate({
      target: [videoJobs.projectId, videoJobs.scene],
      set: {
        provider: job.provider,
        queueJobId: job.queueJobId,
        taskId: job.taskId,
        status: job.status,
        generationId: job.generationId,
        prompt: job.prompt,
        voiceOver: job.voiceOver,
        useProductReference: job.useProductReference ?? false,
        attempts: job.attempts,
        videoUrl: job.videoUrl,
        errorMessage: job.errorMessage,
        lastPolledAt: job.lastPolledAt ? new Date(job.lastPolledAt) : null,
        nextPollAt: job.nextPollAt ? new Date(job.nextPollAt) : null,
        updatedAt: new Date(job.updatedAt),
      },
    });

  return (await getProject(projectId, userId)) as SavedProject;
}

export type CreateVideoGenerationParams = {
  projectId: string;
  scene: number;
  prompt: string;
  voiceOver: string;
  productImageUrl?: string;
  useProductReference: boolean;
  showOverlay: boolean;
  aspectRatio?: "9:16" | "1:1" | "16:9";
};

// Idempotent: if the scene's current video_jobs row is already active
// (ACTIVE_VIDEO_STATUSES), this is a no-op that returns the existing row
// unchanged — a duplicate "Generate Scene" click or a double-submitted
// "Generate All" cannot create two active Wan generations for the same
// scene. A deliberate regenerate action (current row terminal:
// SUCCEEDED/FAILED/CANCELED) always proceeds and mints a fresh
// generation_id. The video_jobs upsert and the outbox insert commit
// atomically, so a generation_id is never persisted without a
// corresponding queue message on the way.
export async function createVideoGenerationWithOutbox(
  params: CreateVideoGenerationParams,
): Promise<{ job: VideoGenerationJob; created: boolean }> {
  const {
    projectId,
    scene,
    prompt,
    voiceOver,
    productImageUrl,
    useProductReference,
    showOverlay,
    aspectRatio,
  } = params;

  return db.transaction(async (tx) => {
    const generationId = crypto.randomUUID();
    const now = new Date();

    const [inserted] = await tx
      .insert(videoJobs)
      .values({
        projectId,
        scene,
        provider: "wan",
        status: "QUEUED",
        generationId,
        prompt,
        voiceOver,
        useProductReference,
        attempts: 0,
        videoUrl: null,
        errorMessage: null,
        taskId: null,
        queueJobId: null,
        lastPolledAt: null,
        nextPollAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [videoJobs.projectId, videoJobs.scene],
        set: {
          status: "QUEUED",
          generationId,
          prompt,
          voiceOver,
          useProductReference,
          attempts: 0,
          videoUrl: null,
          errorMessage: null,
          taskId: null,
          queueJobId: null,
          lastPolledAt: null,
          nextPollAt: null,
          updatedAt: now,
        },
        where: notInArray(videoJobs.status, ACTIVE_VIDEO_STATUSES),
      })
      .returning();

    if (!inserted) {
      const [existing] = await tx
        .select()
        .from(videoJobs)
        .where(and(eq(videoJobs.projectId, projectId), eq(videoJobs.scene, scene)));

      return { job: rowToVideoJob(existing), created: false };
    }

    const payload: VideoCreateJobData = {
      projectId,
      scene,
      prompt,
      voiceOver,
      productImageUrl,
      useProductReference,
      showOverlay,
      aspectRatio,
      generationId,
    };

    await insertOutboxEvent(tx, {
      queue: VIDEO_QUEUE_NAME,
      jobName: "video.create",
      jobKey: `video-create_${projectId}_${scene}_${generationId}`,
      payload,
    });

    return { job: rowToVideoJob(inserted), created: true };
  });
}

export async function updateShowPlan(
  id: string,
  userId: string,
  showPlan: ShowPlan,
): Promise<SavedProject | null> {
  await db
    .update(projects)
    .set({ showPlan })
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));

  return getProject(id, userId);
}

export async function saveFinalVideo(
  projectId: string,
  userId: string,
  finalVideo: FinalVideo,
): Promise<SavedProject> {
  await db
    .insert(finalVideos)
    .values({
      projectId,
      status: finalVideo.status,
      videoUrl: finalVideo.videoUrl,
      errorMessage: finalVideo.errorMessage,
      queueJobId: finalVideo.queueJobId,
      stitchGenerationId: finalVideo.stitchGenerationId,
      createdAt: new Date(finalVideo.createdAt),
      updatedAt: new Date(finalVideo.updatedAt),
    })
    .onConflictDoUpdate({
      target: finalVideos.projectId,
      set: {
        status: finalVideo.status,
        videoUrl: finalVideo.videoUrl,
        errorMessage: finalVideo.errorMessage,
        queueJobId: finalVideo.queueJobId,
        stitchGenerationId: finalVideo.stitchGenerationId,
        updatedAt: new Date(finalVideo.updatedAt),
      },
    });

  return (await getProject(projectId, userId)) as SavedProject;
}

// Same idempotency shape as createVideoGenerationWithOutbox: a no-op
// (returns the current row, created: false) while a stitch is already
// active for this project, so repeated "Stitch Final Video" clicks can't
// create two active stitch operations. An explicit re-stitch after the
// previous one finished (terminal status) always proceeds with a fresh
// stitch_generation_id.
export async function createStitchGenerationWithOutbox(
  projectId: string,
): Promise<{ finalVideo: FinalVideo; created: boolean }> {
  return db.transaction(async (tx) => {
    const stitchGenerationId = crypto.randomUUID();
    const now = new Date();

    const [inserted] = await tx
      .insert(finalVideos)
      .values({
        projectId,
        status: "QUEUED",
        stitchGenerationId,
        videoUrl: null,
        errorMessage: null,
        queueJobId: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: finalVideos.projectId,
        set: {
          status: "QUEUED",
          stitchGenerationId,
          videoUrl: null,
          errorMessage: null,
          queueJobId: null,
          updatedAt: now,
        },
        where: notInArray(finalVideos.status, ACTIVE_VIDEO_STATUSES),
      })
      .returning();

    if (!inserted) {
      const [existing] = await tx
        .select()
        .from(finalVideos)
        .where(eq(finalVideos.projectId, projectId));

      return { finalVideo: rowToFinalVideo(existing), created: false };
    }

    const payload: VideoStitchJobData = { projectId, stitchGenerationId };

    await insertOutboxEvent(tx, {
      queue: VIDEO_QUEUE_NAME,
      jobName: "video.stitch",
      jobKey: `video-stitch_${projectId}_${stitchGenerationId}`,
      payload,
    });

    return { finalVideo: rowToFinalVideo(inserted), created: true };
  });
}

async function rowToProject(row: typeof projects.$inferSelect): Promise<SavedProject> {
  const [videoJobsForProject, finalVideoForProject] = await Promise.all([
    getVideoJobs(row.id),
    getFinalVideo(row.id),
  ]);

  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    showPlan: row.showPlan,
    videoJobs: videoJobsForProject,
    finalVideo: finalVideoForProject,
  };
}

async function getFinalVideo(projectId: string): Promise<FinalVideo | undefined> {
  const rows = await db
    .select()
    .from(finalVideos)
    .where(eq(finalVideos.projectId, projectId));

  const row = rows[0];

  if (!row) {
    return undefined;
  }

  return rowToFinalVideo(row);
}

async function getVideoJobs(projectId: string): Promise<VideoGenerationJob[]> {
  const rows = await db
    .select()
    .from(videoJobs)
    .where(eq(videoJobs.projectId, projectId))
    .orderBy(videoJobs.scene);

  return rows.map(rowToVideoJob);
}

function rowToVideoJob(row: typeof videoJobs.$inferSelect): VideoGenerationJob {
  return {
    scene: row.scene,
    taskId: row.taskId ?? undefined,
    queueJobId: row.queueJobId ?? undefined,
    provider: "wan",
    status: parseVideoGenerationStatus(row.status),
    generationId: row.generationId,
    prompt: row.prompt,
    voiceOver: row.voiceOver ?? undefined,
    useProductReference: row.useProductReference,
    attempts: row.attempts,
    videoUrl: row.videoUrl ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    lastPolledAt: row.lastPolledAt?.toISOString(),
    nextPollAt: row.nextPollAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function rowToFinalVideo(row: typeof finalVideos.$inferSelect): FinalVideo {
  return {
    status: parseVideoGenerationStatus(row.status),
    videoUrl: row.videoUrl ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    queueJobId: row.queueJobId ?? undefined,
    stitchGenerationId: row.stitchGenerationId ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function groupVideoJobsByProjectId(
  rows: (typeof videoJobs.$inferSelect)[],
): Map<string, VideoGenerationJob[]> {
  const grouped = new Map<string, VideoGenerationJob[]>();

  for (const row of rows) {
    const jobs = grouped.get(row.projectId) ?? [];
    jobs.push(rowToVideoJob(row));
    grouped.set(row.projectId, jobs);
  }

  return grouped;
}
