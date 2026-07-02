import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  layout("routes/app-layout.tsx", [
    index("routes/home.tsx"),
    route("generate", "routes/generate.tsx"),
    route("projects", "routes/projects.tsx"),
    route("projects/:projectId", "routes/projects.$projectId.tsx"),
  ]),
  route("health", "routes/health.ts"),
  route("uploads/:filename", "routes/uploads.$filename.tsx"),
  route("auth/*", "routes/auth.$.tsx"),
  route("login", "routes/login.tsx"),
] satisfies RouteConfig;
