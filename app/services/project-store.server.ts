import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ShowPlan } from "~/types/showrunner";
import type { VideoGenerationStatus } from "~/services/wan-video.server";

export type VideoGenerationJob = {
  scene: number;
  taskId: string;
  status: VideoGenerationStatus;
  prompt: string;
  videoUrl?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export type SavedProject = {
  id: string;
  createdAt: string;
  showPlan: ShowPlan;
  videoJobs?: VideoGenerationJob[];
};

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "app.db");
const LEGACY_PROJECTS_FILE = path.join(DATA_DIR, "projects.json");

mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    show_plan TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS video_jobs (
    project_id TEXT NOT NULL REFERENCES projects(id),
    scene INTEGER NOT NULL,
    task_id TEXT NOT NULL,
    status TEXT NOT NULL,
    prompt TEXT NOT NULL,
    video_url TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, scene)
  );
`);

migrateLegacyJsonFile();

function migrateLegacyJsonFile() {
  const projectCount = db
    .prepare("SELECT COUNT(*) AS count FROM projects")
    .get() as { count: number };

  if (projectCount.count > 0 || !existsSync(LEGACY_PROJECTS_FILE)) {
    return;
  }

  const legacyProjects = JSON.parse(
    readFileSync(LEGACY_PROJECTS_FILE, "utf-8"),
  ) as SavedProject[];

  const insertProject = db.prepare(
    "INSERT INTO projects (id, created_at, show_plan) VALUES (?, ?, ?)",
  );
  const insertVideoJob = db.prepare(`
    INSERT INTO video_jobs
      (project_id, scene, task_id, status, prompt, video_url, error_message, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const project of legacyProjects) {
    insertProject.run(
      project.id,
      project.createdAt,
      JSON.stringify(project.showPlan),
    );

    for (const job of project.videoJobs ?? []) {
      insertVideoJob.run(
        project.id,
        job.scene,
        job.taskId,
        job.status,
        job.prompt,
        job.videoUrl ?? null,
        job.errorMessage ?? null,
        job.createdAt,
        job.updatedAt,
      );
    }
  }
}

function rowToVideoJob(row: {
  scene: number;
  task_id: string;
  status: string;
  prompt: string;
  video_url: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}): VideoGenerationJob {
  return {
    scene: row.scene,
    taskId: row.task_id,
    status: row.status as VideoGenerationStatus,
    prompt: row.prompt,
    videoUrl: row.video_url ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getVideoJobs(projectId: string): VideoGenerationJob[] {
  const rows = db
    .prepare(
      "SELECT * FROM video_jobs WHERE project_id = ? ORDER BY scene ASC",
    )
    .all(projectId) as Array<Parameters<typeof rowToVideoJob>[0]>;

  return rows.map(rowToVideoJob);
}

export async function saveProject(showPlan: ShowPlan): Promise<SavedProject> {
  const project: SavedProject = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    showPlan,
  };

  db.prepare(
    "INSERT INTO projects (id, created_at, show_plan) VALUES (?, ?, ?)",
  ).run(project.id, project.createdAt, JSON.stringify(project.showPlan));

  return project;
}

export async function listProjects(): Promise<SavedProject[]> {
  const rows = db
    .prepare("SELECT id, created_at, show_plan FROM projects ORDER BY created_at DESC")
    .all() as Array<{ id: string; created_at: string; show_plan: string }>;

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    showPlan: JSON.parse(row.show_plan) as ShowPlan,
    videoJobs: getVideoJobs(row.id),
  }));
}

export async function getProject(id: string): Promise<SavedProject | null> {
  const row = db
    .prepare("SELECT id, created_at, show_plan FROM projects WHERE id = ?")
    .get(id) as { id: string; created_at: string; show_plan: string } | undefined;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    createdAt: row.created_at,
    showPlan: JSON.parse(row.show_plan) as ShowPlan,
    videoJobs: getVideoJobs(row.id),
  };
}

export async function saveVideoJob(
  projectId: string,
  job: VideoGenerationJob,
): Promise<SavedProject> {
  const exists = db
    .prepare("SELECT 1 FROM projects WHERE id = ?")
    .get(projectId);

  if (!exists) {
    throw new Error("Project not found");
  }

  db.prepare(`
    INSERT INTO video_jobs
      (project_id, scene, task_id, status, prompt, video_url, error_message, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (project_id, scene) DO UPDATE SET
      task_id = excluded.task_id,
      status = excluded.status,
      prompt = excluded.prompt,
      video_url = excluded.video_url,
      error_message = excluded.error_message,
      updated_at = excluded.updated_at
  `).run(
    projectId,
    job.scene,
    job.taskId,
    job.status,
    job.prompt,
    job.videoUrl ?? null,
    job.errorMessage ?? null,
    job.createdAt,
    job.updatedAt,
  );

  return (await getProject(projectId)) as SavedProject;
}
