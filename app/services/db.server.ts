import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required.");
}

export const pool = new Pool({
  connectionString,
});

let schemaPromise: Promise<void> | null = null;

export function ensureDatabaseSchema(): Promise<void> {
  schemaPromise ??= createSchema();
  return schemaPromise;
}

async function createSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL,
      show_plan JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS video_jobs (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      scene INTEGER NOT NULL,
      provider TEXT NOT NULL DEFAULT 'wan',
      queue_job_id TEXT,
      task_id TEXT,
      status TEXT NOT NULL,
      prompt TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      video_url TEXT,
      error_message TEXT,
      last_polled_at TIMESTAMPTZ,
      next_poll_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (project_id, scene)
    );

    CREATE INDEX IF NOT EXISTS video_jobs_status_idx
      ON video_jobs (status);

    CREATE INDEX IF NOT EXISTS video_jobs_next_poll_at_idx
      ON video_jobs (next_poll_at);
  `);
}
