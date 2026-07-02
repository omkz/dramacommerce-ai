import { Link, redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { getAuthSession, getCsrfSetup } from "~/services/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getAuthSession(request);
  const callbackUrl = new URL(request.url).searchParams.get("callbackUrl") || "/projects";

  if (session?.user) {
    return redirect(callbackUrl);
  }

  const { csrfToken, setCookieHeaders } = await getCsrfSetup(request);

  return Response.json({ csrfToken, callbackUrl }, { headers: setCookieHeaders });
}

export function meta() {
  return [{ title: "Sign In | DramaCommerce AI" }];
}

export default function Login() {
  const { csrfToken, callbackUrl } = useLoaderData<typeof loader>();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-ink px-6 text-bone">
      <Link to="/" className="mb-10 flex items-center gap-3">
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-[repeating-linear-gradient(-45deg,var(--color-bone)_0,var(--color-bone)_3px,var(--color-ink)_3px,var(--color-ink)_6px)]"
        />
        <span className="font-display text-lg font-semibold italic tracking-tight text-bone">
          DramaCommerce<span className="text-gold not-italic">.</span>
        </span>
      </Link>

      <div className="w-full max-w-sm rounded-lg border border-paper/10 bg-panel p-8 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-gold">
          Access Pass
        </p>

        <h1 className="mt-3 font-display text-2xl font-medium text-bone">
          Sign in to the studio
        </h1>

        <p className="mt-3 text-sm leading-6 text-ash">
          Every production, storyboard, and final cut lives under your
          account.
        </p>

        <form method="post" action="/auth/signin/google" className="mt-8">
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="callbackUrl" value={callbackUrl} />

          <button
            type="submit"
            className="flex w-full items-center justify-center gap-3 rounded bg-bone px-5 py-3 font-semibold text-ink transition hover:bg-paper"
          >
            <GoogleMark />
            Continue with Google
          </button>
        </form>
      </div>

      <p className="mt-8 text-xs text-ash">
        <Link to="/" className="underline decoration-paper/20 underline-offset-4 hover:text-bone">
          ← Back to home
        </Link>
      </p>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 18 18" className="h-4 w-4">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.61z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.96 10.71a5.4 5.4 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.47.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}
