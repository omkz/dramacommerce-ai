import { Link, Outlet, useLoaderData, useLocation } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { getAuthSession } from "~/services/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getAuthSession(request);

  return { user: session?.user ?? null };
}

export default function AppLayout() {
  const { user } = useLoaderData<typeof loader>();
  const location = useLocation();

  if (user) {
    return (
      <div className="min-h-screen bg-ink text-bone md:pl-64">
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-paper/10 bg-panel md:flex md:flex-col">
          <div className="border-b border-paper/10 p-5">
            <BrandLink />
          </div>

          <nav className="flex-1 space-y-1 p-4">
            <SidebarLink
              to="/dashboard"
              label="Dashboard"
              active={isActivePath(location.pathname, "/dashboard")}
            />
            <SidebarLink
              to="/generate"
              label="Create Ad"
              active={isActivePath(location.pathname, "/generate")}
            />
            <SidebarLink
              to="/projects"
              label="Projects"
              active={isActivePath(location.pathname, "/projects")}
            />
          </nav>

          <div className="border-t border-paper/10 p-4">
            <p className="truncate text-sm font-medium text-bone">
              {user.name ?? user.email}
            </p>
            {user.email && user.name ? (
              <p className="mt-1 truncate text-xs text-ash">{user.email}</p>
            ) : null}

            <a
              href="/auth/signout"
              className="mt-4 inline-flex w-full justify-center rounded border border-paper/15 px-3 py-2 text-sm font-semibold text-bone transition hover:bg-paper/10"
            >
              Sign out
            </a>
          </div>
        </aside>

        <header className="border-b border-paper/10 bg-panel md:hidden">
          <div className="flex items-center justify-between px-5 py-4">
            <BrandLink />
            <a
              href="/auth/signout"
              className="rounded border border-paper/15 px-3 py-1.5 text-sm font-semibold text-bone transition hover:bg-paper/10"
            >
              Sign out
            </a>
          </div>

          <nav className="flex gap-2 overflow-x-auto border-t border-paper/10 px-5 py-3">
            <MobileNavLink
              to="/dashboard"
              label="Dashboard"
              active={isActivePath(location.pathname, "/dashboard")}
            />
            <MobileNavLink
              to="/generate"
              label="Create Ad"
              active={isActivePath(location.pathname, "/generate")}
            />
            <MobileNavLink
              to="/projects"
              label="Projects"
              active={isActivePath(location.pathname, "/projects")}
            />
          </nav>
        </header>

        <Outlet />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink">
      <header className="border-b border-paper/10 bg-panel">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <BrandLink />

          <Link
            to="/login?callbackUrl=/dashboard"
            className="rounded bg-gold px-3 py-1.5 text-sm font-semibold text-ink transition hover:bg-gold/85"
          >
            Sign in with Google
          </Link>
        </div>
      </header>

      <Outlet />
    </div>
  );
}

function BrandLink() {
  return (
    <Link to="/" className="flex items-center gap-3">
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-[repeating-linear-gradient(-45deg,var(--color-bone)_0,var(--color-bone)_3px,var(--color-ink)_3px,var(--color-ink)_6px)]"
      />
      <span className="font-display text-lg font-semibold italic tracking-tight text-bone">
        DramaCommerce<span className="text-gold not-italic">.</span>
      </span>
    </Link>
  );
}

function SidebarLink({
  to,
  label,
  active,
}: {
  to: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      className={
        active
          ? "block rounded-sm border border-gold/25 bg-gold/10 px-4 py-3 text-sm font-semibold text-gold"
          : "block rounded-sm px-4 py-3 text-sm font-semibold text-ash transition hover:bg-paper/10 hover:text-bone"
      }
    >
      {label}
    </Link>
  );
}

function MobileNavLink({
  to,
  label,
  active,
}: {
  to: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      className={
        active
          ? "shrink-0 rounded border border-gold/40 bg-gold/10 px-3 py-1.5 text-sm font-semibold text-gold"
          : "shrink-0 rounded border border-paper/15 px-3 py-1.5 text-sm font-semibold text-bone"
      }
    >
      {label}
    </Link>
  );
}

function isActivePath(pathname: string, basePath: string): boolean {
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}
