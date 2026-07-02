import { and, desc, eq } from "drizzle-orm";
import { finalVideos, projects, videoJobs } from "~/db/schema";
import { db } from "~/services/db.server";
import type { VideoGenerationStatus } from "~/services/wan-video.server";
import type { ShowPlan } from "~/types/showrunner";

export type VideoGenerationJob = {
  scene: number;
  taskId?: string;
  queueJobId?: string;
  provider: "wan";
  status: VideoGenerationStatus;
  prompt: string;
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

export async function saveProject(
  showPlan: ShowPlan,
  userId: string,
): Promise<SavedProject> {
  const project: SavedProject = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    showPlan,
  };

  await db.insert(projects).values({
    id: project.id,
    userId,
    createdAt: new Date(project.createdAt),
    showPlan: project.showPlan,
  });

  return project;
}

export async function listProjects(userId: string): Promise<SavedProject[]> {
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.createdAt));

  return Promise.all(rows.map(rowToProject));
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
      prompt: job.prompt,
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
        prompt: job.prompt,
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
        updatedAt: new Date(finalVideo.updatedAt),
      },
    });

  return (await getProject(projectId, userId)) as SavedProject;
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

  return {
    status: row.status as VideoGenerationStatus,
    videoUrl: row.videoUrl ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    queueJobId: row.queueJobId ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
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
    status: row.status as VideoGenerationStatus,
    prompt: row.prompt,
    attempts: row.attempts,
    videoUrl: row.videoUrl ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    lastPolledAt: row.lastPolledAt?.toISOString(),
    nextPollAt: row.nextPollAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
