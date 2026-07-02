import { Auth } from "@auth/core";
import type { AuthConfig, Session } from "@auth/core/types";
import Google from "@auth/core/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { redirect } from "react-router";
import { accounts, sessions, users, verificationTokens } from "~/db/schema";
import { db } from "~/services/db.server";

function mustGetEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

export const authConfig: AuthConfig = {
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    Google({
      clientId: mustGetEnv("AUTH_GOOGLE_ID"),
      clientSecret: mustGetEnv("AUTH_GOOGLE_SECRET"),
    }),
  ],
  session: { strategy: "database" },
  secret: mustGetEnv("AUTH_SECRET"),
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  callbacks: {
    // Auth.js's default session callback strips everything but
    // name/email/image from session.user — add id back so callers can
    // scope data (e.g. projects) to the logged-in merchant.
    session({ session, user }) {
      return {
        ...session,
        user: { ...session.user, id: user.id },
      };
    },
  },
};

export type AuthenticatedUser = Session["user"] & { id: string };

// @auth/core has no React Router integration package, so we call its
// Auth(request, config) entry point directly (the same thing framework
// wrappers like ExpressAuth/SvelteKitAuth do under the hood). To read the
// current session outside of the /auth/* resource route, we replay the
// incoming request's cookies against Auth.js's own /auth/session endpoint.
export async function getAuthSession(request: Request): Promise<Session | null> {
  const url = new URL(request.url);
  const sessionRequest = new Request(`${url.origin}/auth/session`, {
    headers: { cookie: request.headers.get("cookie") ?? "" },
  });

  const response = await Auth(sessionRequest, authConfig);
  const session = (await response.json().catch(() => null)) as Session | null;

  return session?.user ? session : null;
}

export async function requireUser(request: Request): Promise<AuthenticatedUser> {
  const session = await getAuthSession(request);

  if (!session?.user?.id) {
    const callbackUrl = new URL(request.url).pathname;

    throw redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  return session.user as AuthenticatedUser;
}

// Custom-styled /login page needs a CSRF token to submit the real
// /auth/signin/:provider POST (Auth.js's double-submit-cookie check
// compares this value against the authjs.csrf-token cookie set below).
// Reuses the same "replay against the internal /auth/* endpoint" trick as
// getAuthSession — but this one also forwards Set-Cookie headers, since the
// browser must actually receive the csrf cookie for the round trip to work.
export async function getCsrfSetup(
  request: Request,
): Promise<{ csrfToken: string; setCookieHeaders: Headers }> {
  const url = new URL(request.url);
  const csrfRequest = new Request(`${url.origin}/auth/csrf`, {
    headers: { cookie: request.headers.get("cookie") ?? "" },
  });

  const response = await Auth(csrfRequest, authConfig);
  const body = (await response.json()) as { csrfToken: string };

  const setCookieHeaders = new Headers();

  for (const cookie of response.headers.getSetCookie()) {
    setCookieHeaders.append("Set-Cookie", cookie);
  }

  return { csrfToken: body.csrfToken, setCookieHeaders };
}
