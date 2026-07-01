import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ShowPlan } from "~/types/showrunner";

export type SavedProject = {
  id: string;
  createdAt: string;
  showPlan: ShowPlan;
};

const DATA_DIR = path.join(process.cwd(), "data");
const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");

async function ensureDataFile() {
  await mkdir(DATA_DIR, { recursive: true });

  try {
    await readFile(PROJECTS_FILE, "utf-8");
  } catch {
    await writeFile(PROJECTS_FILE, "[]", "utf-8");
  }
}

export async function saveProject(showPlan: ShowPlan): Promise<SavedProject> {
  await ensureDataFile();

  const projects = await listProjects();

  const project: SavedProject = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    showPlan,
  };

  projects.unshift(project);

  await writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2), "utf-8");

  return project;
}

export async function listProjects(): Promise<SavedProject[]> {
  await ensureDataFile();

  const raw = await readFile(PROJECTS_FILE, "utf-8");

  return JSON.parse(raw) as SavedProject[];
}

export async function getProject(id: string): Promise<SavedProject | null> {
  const projects = await listProjects();

  return projects.find((project) => project.id === id) ?? null;
}
