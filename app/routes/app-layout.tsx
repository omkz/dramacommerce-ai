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
    <div className="bg-slate-950">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link
            to="/"
            className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300"
          >
            DramaCommerce AI
          </Link>

          {user ? (
            <div className="flex items-center gap-4 text-sm">
              <span className="text-slate-300">{user.name ?? user.email}</span>
              <a
                href="/auth/signout"
                className="rounded-lg border border-white/15 px-3 py-1.5 font-semibold text-white transition hover:bg-white/10"
              >
                Sign out
              </a>
            </div>
          ) : (
            <a
              href="/auth/signin?callbackUrl=/projects"
              className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-slate-950 transition hover:bg-slate-200"
            >
              Sign in with Google
            </a>
          )}
        </div>
      </header>

      <Outlet />
    </div>
  );
}
