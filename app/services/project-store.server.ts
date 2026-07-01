import { desc, eq } from "drizzle-orm";
import { projects, videoJobs } from "~/db/schema";
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

export type SavedProject = {
  id: string;
  createdAt: string;
  showPlan: ShowPlan;
  videoJobs?: VideoGenerationJob[];
};

export async function saveProject(showPlan: ShowPlan): Promise<SavedProject> {
  const project: SavedProject = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    showPlan,
  };

  await db.insert(projects).values({
    id: project.id,
    createdAt: new Date(project.createdAt),
    showPlan: project.showPlan,
  });

  return project;
}

export async function listProjects(): Promise<SavedProject[]> {
  const rows = await db.select().from(projects).orderBy(desc(projects.createdAt));

  return Promise.all(rows.map(rowToProject));
}

export async function getProject(id: string): Promise<SavedProject | null> {
  const rows = await db.select().from(projects).where(eq(projects.id, id));

  if (!rows[0]) {
    return null;
  }

  return rowToProject(rows[0]);
}

export async function saveVideoJob(
  projectId: string,
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

  return (await getProject(projectId)) as SavedProject;
}

async function rowToProject(row: typeof projects.$inferSelect): Promise<SavedProject> {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    showPlan: row.showPlan,
    videoJobs: await getVideoJobs(row.id),
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
