import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { listProjects } from "~/services/project-store.server";
import { requireUser } from "~/services/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const projects = await listProjects(user.id);

  return {
    projects,
  };
}

export function meta() {
  return [
    { title: "Projects | DramaCommerce AI" },
    {
      name: "description",
      content: "View generated product drama ad projects.",
    },
  ];
}

export default function ProjectsIndex() {
  const { projects } = useLoaderData<typeof loader>();

  return (
    <main className="min-h-screen bg-ink px-6 py-10 text-bone">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-gold">
              The Archive
            </p>

            <h1 className="mt-3 font-display text-4xl font-medium tracking-tight text-bone md:text-5xl">
              Productions
            </h1>

            <p className="mt-4 max-w-2xl text-ash">
              Every drama ad your account has produced, ready to review or
              rerelease.
            </p>
          </div>

          <Link
            to="/generate"
            className="rounded bg-flame px-5 py-3 font-semibold text-bone transition hover:bg-flame/90"
          >
            Start a Production
          </Link>
        </div>

        {projects.length === 0 ? (
          <section className="mt-10 rounded-lg border border-paper/10 bg-panel p-10 text-center">
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-ash">
              Empty Slate
            </p>
            <h2 className="mt-3 font-display text-2xl font-medium text-bone">
              No productions yet
            </h2>
            <p className="mt-3 text-ash">
              Generate your first product drama ad plan.
            </p>

            <Link
              to="/generate"
              className="mt-6 inline-flex rounded bg-flame px-5 py-3 font-semibold text-bone transition hover:bg-flame/90"
            >
              Start a Production
            </Link>
          </section>
        ) : (
          <section className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => {
              const showPlan = project.showPlan;

              return (
                <Link
                  key={project.id}
                  to={`/projects/${project.id}`}
                  className="group overflow-hidden rounded-lg border border-paper/10 bg-panel transition hover:border-gold/40"
                >
                  {showPlan.brief.imageUrl ? (
                    <div className="flex h-48 items-center justify-center bg-panel-raised">
                      <img
                        src={showPlan.brief.imageUrl}
                        alt={showPlan.brief.productName}
                        className="h-full w-full object-contain p-4 transition group-hover:scale-105"
                      />
                    </div>
                  ) : (
                    <div className="flex h-48 items-center justify-center bg-panel-raised text-ash">
                      No image
                    </div>
                  )}

                  <div className="p-5">
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className={
                          showPlan.source === "qwen"
                            ? "rounded-full border border-gold/30 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-gold"
                            : "rounded-full border border-ash/30 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-ash"
                        }
                      >
                        {showPlan.source === "qwen" ? "Qwen" : "Mock"}
                      </span>

                      <span className="font-mono text-xs text-ash">
                        {new Date(project.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    <h2 className="mt-4 line-clamp-2 font-display text-xl font-medium text-bone">
                      {showPlan.brief.productName}
                    </h2>

                    <p className="mt-3 line-clamp-3 text-sm leading-6 text-ash">
                      {showPlan.concept}
                    </p>

                    <div className="mt-5 grid grid-cols-2 gap-3 text-xs">
                      <div className="rounded-sm border border-paper/10 bg-panel-raised p-3">
                        <p className="font-mono uppercase tracking-widest text-ash">
                          Platform
                        </p>
                        <p className="mt-1 font-medium text-bone">
                          {showPlan.brief.platform}
                        </p>
                      </div>

                      <div className="rounded-sm border border-paper/10 bg-panel-raised p-3">
                        <p className="font-mono uppercase tracking-widest text-ash">
                          Mood
                        </p>
                        <p className="mt-1 font-medium text-bone">
                          {showPlan.brief.mood}
                        </p>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}
