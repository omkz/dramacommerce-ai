import { Link, Outlet, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { getAuthSession } from "~/services/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getAuthSession(request);

  return { user: session?.user ?? null };
}

export default function AppLayout() {
  const { user } = useLoaderData<typeof loader>();

  return (
    <div className="bg-ink">
      <header className="border-b border-paper/10 bg-panel">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-[repeating-linear-gradient(-45deg,var(--color-bone)_0,var(--color-bone)_3px,var(--color-ink)_3px,var(--color-ink)_6px)]"
            />
            <span className="font-display text-lg font-semibold italic tracking-tight text-bone">
              DramaCommerce<span className="text-gold not-italic">.</span>
            </span>
          </Link>

          {user ? (
            <div className="flex items-center gap-4 text-sm">
              <nav className="hidden items-center gap-3 md:flex">
                <Link to="/dashboard" className="text-ash transition hover:text-bone">
                  Dashboard
                </Link>
                <Link to="/projects" className="text-ash transition hover:text-bone">
                  Projects
                </Link>
                <Link to="/generate" className="text-ash transition hover:text-bone">
                  Generate
                </Link>
              </nav>
              <span className="text-ash">{user.name ?? user.email}</span>
              <a
                href="/auth/signout"
                className="rounded border border-paper/15 px-3 py-1.5 font-semibold text-bone transition hover:bg-paper/10"
              >
                Sign out
              </a>
            </div>
          ) : (
            <Link
              to="/login?callbackUrl=/projects"
              className="rounded bg-gold px-3 py-1.5 text-sm font-semibold text-ink transition hover:bg-gold/85"
            >
              Sign in with Google
            </Link>
          )}
        </div>
      </header>

      <Outlet />
    </div>
  );
}
