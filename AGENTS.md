# Repository Guidelines

## Project Structure & Module Organization

DramaCommerce AI is a React Router 8 full-stack TypeScript app. Application code lives in `app/`: route modules are in `app/routes/`, route registration is explicit in `app/routes.ts`, shared UI/root setup is in `app/root.tsx`, and global styles are in `app/app.css`. Server-only business logic is split between `app/services/*.server.ts` and `app/agents/*.server.ts`; do not import these modules into client-only code. Shared generated-plan types live in `app/types/showrunner.ts`. Static assets belong in `public/`, documentation in `docs/`, and local runtime files in gitignored `data/` and `uploads/`.

## Build, Test, and Development Commands

Use `pnpm`; this repo has a `pnpm-lock.yaml`.

- `pnpm install` installs dependencies.
- `pnpm dev` starts the React Router dev server at `http://localhost:5173`.
- `pnpm run typecheck` runs `react-router typegen` and `tsc`; use this after changing routes, loaders, actions, or shared types.
- `pnpm run build` creates the production build.
- `pnpm run start` serves `./build/server/index.js`.

Docker support is available with `docker build -t dramacommerce-ai .` and `docker run --env-file .env -p 3000:3000 dramacommerce-ai`.

## Coding Style & Naming Conventions

Write TypeScript modules using ES modules and React function components. Follow existing 2-space indentation, double quotes in imports, and descriptive camelCase names for variables and functions. Keep route files named for their URL pattern, for example `projects.$projectId.tsx`. Use `.server.ts` for Node-only services, API integrations, storage, and agent pipeline code.

## Testing Guidelines

No test runner or lint script is currently configured. For now, validate changes with `pnpm run typecheck` and, when behavior changes, manual flows in `pnpm dev`: generate a project, inspect `/projects`, and test the Scene 1 video task actions when credentials are available. If adding tests, colocate them near the module under test and document the new command in `package.json`.

## Commit & Pull Request Guidelines

Git history uses short imperative commit subjects such as `Add Wan video generation for scene 1` and `Migrate project storage from JSON file to SQLite`. Keep commits focused and explain user-visible behavior in the subject. Pull requests should include a concise summary, manual verification steps, linked issues when relevant, screenshots for UI changes, and notes about any environment variable or storage changes.

## Security & Configuration Tips

Copy `.env.example` to `.env` and keep API keys out of git. `QWEN_BASE_URL` should include `/compatible-mode/v1`; `DASHSCOPE_VIDEO_BASE_URL` should not. Do not add automatic mock fallback for production generation; Qwen failures should surface as errors.
