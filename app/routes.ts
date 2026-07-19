import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  layout("routes/app-layout.tsx", [
    index("routes/home.tsx"),
    route("dashboard", "routes/dashboard.tsx"),
    route("billing", "routes/billing.tsx"),
    route("projects", "routes/projects.tsx"),
    route("projects/new", "routes/projects.new.tsx"),
    route("projects/new/:jobId", "routes/projects.new.$jobId.tsx"),
    route("projects/:projectId", "routes/projects.$projectId.tsx"),
  ]),
  route("health", "routes/health.ts"),
  route("uploads/*", "routes/uploads.$.tsx"),
  route("auth/*", "routes/auth.$.tsx"),
  route("login", "routes/login.tsx"),
] satisfies RouteConfig;
