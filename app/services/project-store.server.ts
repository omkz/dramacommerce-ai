import { ensureDatabaseSchema, pool } from "~/services/db.server";
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

type ProjectRow = {
  id: string;
  created_at: Date | string;
  show_plan: ShowPlan;
};

type VideoJobRow = {
  scene: number;
  task_id: string | null;
  queue_job_id: string | null;
  provider: string;
  status: string;
  prompt: string;
  attempts: number;
  video_url: string | null;
  error_message: string | null;
  last_polled_at: Date | string | null;
  next_poll_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export async function saveProject(showPlan: ShowPlan): Promise<SavedProject> {
  await ensureDatabaseSchema();

  const project: SavedProject = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    showPlan,
  };

  await pool.query(
    "INSERT INTO projects (id, created_at, show_plan) VALUES ($1, $2, $3)",
    [project.id, project.createdAt, JSON.stringify(project.showPlan)],
  );

  return project;
}

export async function listProjects(): Promise<SavedProject[]> {
  await ensureDatabaseSchema();

  const { rows } = await pool.query<ProjectRow>(
    "SELECT id, created_at, show_plan FROM projects ORDER BY created_at DESC",
  );

  return Promise.all(rows.map(rowToProject));
}

export async function getProject(id: string): Promise<SavedProject | null> {
  await ensureDatabaseSchema();

  const { rows } = await pool.query<ProjectRow>(
    "SELECT id, created_at, show_plan FROM projects WHERE id = $1",
    [id],
  );

  if (!rows[0]) {
    return null;
  }

  return rowToProject(rows[0]);
}

export async function saveVideoJob(
  projectId: string,
  job: VideoGenerationJob,
): Promise<SavedProject> {
  await ensureDatabaseSchema();

  await pool.query(
    `
    INSERT INTO video_jobs
      (
        project_id,
        scene,
        provider,
        queue_job_id,
        task_id,
        status,
        prompt,
        attempts,
        video_url,
        error_message,
        last_polled_at,
        next_poll_at,
        created_at,
        updated_at
      )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    ON CONFLICT (project_id, scene) DO UPDATE SET
      provider = excluded.provider,
      queue_job_id = excluded.queue_job_id,
      task_id = excluded.task_id,
      status = excluded.status,
      prompt = excluded.prompt,
      attempts = excluded.attempts,
      video_url = excluded.video_url,
      error_message = excluded.error_message,
      last_polled_at = excluded.last_polled_at,
      next_poll_at = excluded.next_poll_at,
      updated_at = excluded.updated_at
  `,
    [
      projectId,
      job.scene,
      job.provider,
      job.queueJobId ?? null,
      job.taskId ?? null,
      job.status,
      job.prompt,
      job.attempts,
      job.videoUrl ?? null,
      job.errorMessage ?? null,
      job.lastPolledAt ?? null,
      job.nextPollAt ?? null,
      job.createdAt,
      job.updatedAt,
    ],
  );

  return (await getProject(projectId)) as SavedProject;
}

async function rowToProject(row: ProjectRow): Promise<SavedProject> {
  return {
    id: row.id,
    createdAt: toIsoString(row.created_at),
    showPlan: row.show_plan,
    videoJobs: await getVideoJobs(row.id),
  };
}

async function getVideoJobs(projectId: string): Promise<VideoGenerationJob[]> {
  const { rows } = await pool.query<VideoJobRow>(
    "SELECT * FROM video_jobs WHERE project_id = $1 ORDER BY scene ASC",
    [projectId],
  );

  return rows.map(rowToVideoJob);
}

function rowToVideoJob(row: VideoJobRow): VideoGenerationJob {
  return {
    scene: row.scene,
    taskId: row.task_id ?? undefined,
    queueJobId: row.queue_job_id ?? undefined,
    provider: "wan",
    status: row.status as VideoGenerationStatus,
    prompt: row.prompt,
    attempts: row.attempts,
    videoUrl: row.video_url ?? undefined,
    errorMessage: row.error_message ?? undefined,
    lastPolledAt: row.last_polled_at
      ? toIsoString(row.last_polled_at)
      : undefined,
    nextPollAt: row.next_poll_at ? toIsoString(row.next_poll_at) : undefined,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
