import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("generate", "routes/generate.tsx"),
  route("projects/:projectId", "routes/projects.$projectId.tsx"),
] satisfies RouteConfig;
