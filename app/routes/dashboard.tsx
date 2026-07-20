import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import {
  listProjectsForDisplay,
  type SavedProject,
  type VideoGenerationJob,
} from "~/services/project-store.server";
import { requireUser } from "~/services/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const projects = await listProjectsForDisplay(user.id);

  return {
    projects,
    stats: buildDashboardStats(projects),
  };
}

export function meta() {
  return [
    { title: "Dashboard | DramaCommerce AI" },
    {
      name: "description",
      content: "Production dashboard for product drama video projects.",
    },
  ];
}

export default function Dashboard() {
  const { projects, stats } = useLoaderData<typeof loader>();
  const recentProjects = projects.slice(0, 5);
  const attentionProjects = projects
    .filter(
      (project) =>
        project.schemaStatus === "invalid" || hasFailedVideo(project) || hasInFlightVideo(project),
    )
    .slice(0, 4);

  return (
    <main className="min-h-screen bg-ink px-6 py-10 text-bone">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-gold">
              Production Dashboard
            </p>

            <h1 className="mt-3 font-display text-4xl font-medium tracking-tight text-bone md:text-5xl">
              Product video studio
            </h1>

            <p className="mt-4 max-w-2xl text-ash">
              Monitor generated product videos, render progress, final cuts, and
              projects that need attention.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              to="/projects/new"
              className="rounded bg-flame px-5 py-3 font-semibold text-bone transition hover:bg-flame/90"
            >
              Create Product Video
            </Link>
            <Link
              to="/projects"
              className="rounded border border-paper/15 px-5 py-3 font-semibold text-bone transition hover:bg-paper/10"
            >
              Project Library
            </Link>
          </div>
        </div>

        <section className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Projects" value={String(stats.totalProjects)} detail="Saved video plans" />
          <MetricCard label="Final Videos" value={String(stats.finalVideosReady)} detail="Ready to download" />
          <MetricCard label="Scene Renders" value={`${stats.scenesSucceeded}/${stats.scenesTotal}`} detail="Successful clips" />
          <MetricCard label="Needs Attention" value={String(stats.failedScenes + stats.failedFinalVideos)} detail="Failed render/stitch jobs" tone={stats.failedScenes + stats.failedFinalVideos > 0 ? "alert" : "normal"} />
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <Panel title="Recent Projects" eyebrow="Library">
              {recentProjects.length > 0 ? (
                <div className="divide-y divide-paper/10">
                  {recentProjects.map((project) => (
                    <ProjectRow key={project.id} project={project} />
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No projects yet"
                  body="Create your first product drama video to populate the dashboard."
                  actionLabel="Create Product Video"
                  actionTo="/projects/new"
                />
              )}
            </Panel>

            <Panel title="Render Pipeline" eyebrow="Status">
              <div className="grid gap-3 sm:grid-cols-3">
                <SmallStat label="Queued / Running" value={String(stats.inFlightScenes)} />
                <SmallStat label="Reference Scenes" value={String(stats.referenceScenes)} />
                <SmallStat label="Stitched Finals" value={String(stats.finalVideosReady)} />
              </div>

              <div className="mt-5 h-2 overflow-hidden rounded-full bg-paper/10">
                <div
                  className="h-full rounded-full bg-gold"
                  style={{ width: `${stats.sceneCompletionRate}%` }}
                />
              </div>

              <p className="mt-3 text-sm text-ash">
                {stats.sceneCompletionRate}% of queued scene slots have
                rendered successfully.
              </p>
            </Panel>
          </div>

          <aside className="space-y-6 lg:sticky lg:top-6">
            <Panel title="Attention Queue" eyebrow="Ops">
              {attentionProjects.length > 0 ? (
                <div className="space-y-3">
                  {attentionProjects.map((project) => (
                    <Link
                      key={project.id}
                      to={`/projects/${project.id}`}
                      className="block rounded-sm border border-paper/10 bg-panel-raised p-4 transition hover:border-gold/35"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="line-clamp-2 text-sm font-semibold text-bone">
                          {project.schemaStatus === "invalid"
                            ? "Project data needs regeneration"
                            : project.showPlan.brief.productName}
                        </p>
                        <StatusPill label={getProjectHealth(project)} />
                      </div>
                      <p className="mt-2 text-xs leading-5 text-ash">
                        {getProjectHealthDetail(project)}
                      </p>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="rounded-sm border border-paper/10 bg-panel-raised p-4 text-sm leading-6 text-ash">
                  No failed or active render jobs right now.
                </p>
              )}
            </Panel>

            <Panel title="Default Render Setup" eyebrow="Output">
              <div className="space-y-3 text-sm text-ash">
                <SmallStat label="Aspect Ratio" value="9:16 Portrait" />
                <SmallStat label="Story Duration" value="30s" />
                <SmallStat label="Resolution" value="720x1280 / 1080x1920" />
              </div>
            </Panel>
          </aside>
        </section>
      </div>
    </main>
  );
}

type DashboardStats = {
  totalProjects: number;
  scenesTotal: number;
  scenesSucceeded: number;
  inFlightScenes: number;
  failedScenes: number;
  referenceScenes: number;
  finalVideosReady: number;
  failedFinalVideos: number;
  sceneCompletionRate: number;
};

function buildDashboardStats(projects: SavedProject[]): DashboardStats {
  // videoJobs/finalVideo stats are independent of show_plan validity;
  // storyboard-derived stats (scenesTotal, referenceScenes) only make sense
  // for projects whose show_plan actually parsed.
  const validProjects = projects.filter((project) => project.schemaStatus === "ok");
  const scenesTotal = validProjects.reduce(
    (total, project) => total + project.showPlan.storyboard.length,
    0,
  );
  const videoJobs = projects.flatMap((project) => project.videoJobs ?? []);
  const scenesSucceeded = videoJobs.filter((job) => job.status === "SUCCEEDED").length;
  const inFlightScenes = videoJobs.filter(isInFlightVideoJob).length;
  const failedScenes = videoJobs.filter(isFailedVideoJob).length;
  const referenceScenes = validProjects.reduce(
    (total, project) =>
      total +
      project.showPlan.storyboard.filter((scene) => scene.useProductReference)
        .length,
    0,
  );
  const finalVideosReady = projects.filter(
    (project) => project.finalVideo?.status === "SUCCEEDED",
  ).length;
  const failedFinalVideos = projects.filter(
    (project) =>
      project.finalVideo?.status === "FAILED" ||
      project.finalVideo?.status === "CANCELED",
  ).length;

  return {
    totalProjects: projects.length,
    scenesTotal,
    scenesSucceeded,
    inFlightScenes,
    failedScenes,
    referenceScenes,
    finalVideosReady,
    failedFinalVideos,
    sceneCompletionRate:
      scenesTotal > 0 ? Math.round((scenesSucceeded / scenesTotal) * 100) : 0,
  };
}

function ProjectRow({ project }: { project: SavedProject }) {
  if (project.schemaStatus === "invalid") {
    return (
      <Link
        to={`/projects/${project.id}`}
        className="grid gap-4 py-5 transition hover:bg-paper/[0.03] md:grid-cols-[96px_minmax(0,1fr)_auto]"
      >
        <div className="flex h-24 items-center justify-center overflow-hidden rounded-sm border border-flame/30 bg-panel-raised">
          <span className="font-mono text-[10px] uppercase tracking-widest text-flame">
            Invalid
          </span>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill label="Invalid" />
            <span className="font-mono text-xs text-ash">
              {new Date(project.createdAt).toLocaleDateString()}
            </span>
          </div>

          <h2 className="mt-2 line-clamp-1 font-display text-xl font-medium text-bone">
            Project data needs regeneration
          </h2>

          <p className="mt-2 line-clamp-2 text-sm leading-6 text-ash">
            This project&rsquo;s saved data no longer matches the expected schema. Open it to delete and start over.
          </p>
        </div>

        <div className="flex items-center gap-3 text-sm md:justify-end" />
      </Link>
    );
  }

  const successfulScenes =
    project.videoJobs?.filter((job) => job.status === "SUCCEEDED").length ?? 0;
  const totalScenes = project.showPlan.storyboard.length;

  return (
    <Link
      to={`/projects/${project.id}`}
      className="grid gap-4 py-5 transition hover:bg-paper/[0.03] md:grid-cols-[96px_minmax(0,1fr)_auto]"
    >
      <div className="flex h-24 items-center justify-center overflow-hidden rounded-sm border border-paper/10 bg-panel-raised">
        {project.showPlan.brief.imageUrl ? (
          <img
            src={project.showPlan.brief.imageUrl}
            alt={project.showPlan.brief.productName}
            className="h-full w-full object-contain p-2"
          />
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-widest text-ash">
            No image
          </span>
        )}
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill label={getProjectHealth(project)} />
          <span className="font-mono text-xs text-ash">
            {new Date(project.createdAt).toLocaleDateString()}
          </span>
        </div>

        <h2 className="mt-2 line-clamp-1 font-display text-xl font-medium text-bone">
          {project.showPlan.brief.productName}
        </h2>

        <p className="mt-2 line-clamp-2 text-sm leading-6 text-ash">
          {project.showPlan.concept}
        </p>
      </div>

      <div className="flex items-center gap-3 text-sm md:justify-end">
        <SmallStat label="Scenes" value={`${successfulScenes}/${totalScenes}`} />
      </div>
    </Link>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone = "normal",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "normal" | "alert";
}) {
  return (
    <div
      className={
        tone === "alert"
          ? "rounded-lg border border-flame/35 bg-flame/10 p-5"
          : "rounded-lg border border-paper/10 bg-panel p-5"
      }
    >
      <p className="font-mono text-[11px] uppercase tracking-widest text-ash">
        {label}
      </p>
      <p className="mt-3 font-display text-3xl font-medium text-bone">{value}</p>
      <p className="mt-1 text-sm text-ash">{detail}</p>
    </div>
  );
}

function Panel({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-paper/10 bg-panel p-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-gold">
        {eyebrow}
      </p>
      <h2 className="mt-1 font-display text-xl font-medium text-bone">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-paper/10 bg-panel-raised p-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-ash">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-bone">{value}</p>
    </div>
  );
}

function EmptyState({
  title,
  body,
  actionLabel,
  actionTo,
}: {
  title: string;
  body: string;
  actionLabel: string;
  actionTo: string;
}) {
  return (
    <div className="rounded-sm border border-paper/10 bg-panel-raised p-8 text-center">
      <h3 className="font-display text-xl font-medium text-bone">{title}</h3>
      <p className="mt-2 text-sm text-ash">{body}</p>
      <Link
        to={actionTo}
        className="mt-5 inline-flex rounded bg-flame px-4 py-2 text-sm font-semibold text-bone transition hover:bg-flame/90"
      >
        {actionLabel}
      </Link>
    </div>
  );
}

function StatusPill({ label }: { label: string }) {
  const isAlert = label === "Failed" || label === "Invalid";
  const isActive = label === "Rendering";
  const isReady = label === "Completed";

  return (
    <span
      className={
        isAlert
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

function getProjectHealth(project: SavedProject): string {
  if (project.schemaStatus === "invalid") return "Invalid";
  if (hasFailedVideo(project)) return "Failed";
  if (hasInFlightVideo(project)) return "Rendering";
  if (project.finalVideo?.status === "SUCCEEDED") return "Completed";
  return "Draft";
}

function getProjectHealthDetail(project: SavedProject): string {
  if (project.schemaStatus === "invalid") {
    return "Saved data no longer matches the expected schema. Open the project to delete and regenerate.";
  }

  if (hasFailedVideo(project)) {
    return "One or more render or stitch jobs failed. Open the project to retry.";
  }

  if (hasInFlightVideo(project)) {
    return "A render or final stitch is still being processed.";
  }

  return "No active render issues.";
}

function hasFailedVideo(project: SavedProject): boolean {
  return (
    project.videoJobs?.some(isFailedVideoJob) ||
    project.finalVideo?.status === "FAILED" ||
    project.finalVideo?.status === "CANCELED" ||
    false
  );
}

function hasInFlightVideo(project: SavedProject): boolean {
  return (
    project.videoJobs?.some(isInFlightVideoJob) ||
    (project.finalVideo ? isInFlightStatus(project.finalVideo.status) : false)
  );
}

function isInFlightVideoJob(job: VideoGenerationJob): boolean {
  return isInFlightStatus(job.status);
}

function isFailedVideoJob(job: VideoGenerationJob): boolean {
  return job.status === "FAILED" || job.status === "CANCELED";
}

function isInFlightStatus(status: string): boolean {
  return status === "QUEUED" || status === "PENDING" || status === "RUNNING";
}
