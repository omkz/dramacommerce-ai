# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

DramaCommerce AI is a React Router 8 full-stack app. A merchant uploads a product image plus a short brief (audience, mood, platform, duration); the app runs a Qwen-powered AI "showrunner" pipeline that produces a story concept, hook, voice-over, a 5-scene storyboard with video prompts, an editing timeline, a social caption/CTA, and can kick off a real text-to-video render for scene 1 via Alibaba Cloud's Wan model.

## Commands

Package manager is **pnpm** (see `pnpm-lock.yaml` and the Dockerfile).

- `pnpm dev` — start the dev server (React Router dev, HMR) at `http://localhost:5173`
- `pnpm run typecheck` — runs `react-router typegen` then `tsc` (regenerate route types before type-checking after changing `app/routes.ts` or route loader/action signatures)
- `pnpm run build` — production build
- `pnpm run start` — serve the production build (`react-router-serve ./build/server/index.js`)

There is no test suite and no lint script configured in `package.json`.

## Environment

Copy `.env.example` to `.env`. Two separate Alibaba Cloud DashScope surfaces are used with different base URLs:

- `DASHSCOPE_API_KEY`, `QWEN_BASE_URL` (includes `/compatible-mode/v1` — OpenAI-compatible chat completions), `QWEN_MODEL` — for the showrunner planning step.
- `DASHSCOPE_VIDEO_BASE_URL` (no `/compatible-mode/v1` suffix — uses `/api/v1/services/...` and `/api/v1/tasks/...`), `WAN_VIDEO_MODEL`, `WAN_VIDEO_RESOLUTION`, `WAN_VIDEO_RATIO`, `WAN_VIDEO_DURATION` — for Wan video generation.

If Qwen env vars are missing or the Qwen call fails, generation returns an error and no project is created. Do not reintroduce automatic mock fallback for production generation.

## Architecture

### Pipeline: brief → showrunner → project → video

1. `routes/generate.tsx` (`action`) collects the form/multipart submission, saves the uploaded image via `services/image-upload.server.ts`, calls `services/showrunner.server.ts#generateShowPlan`, persists the result with `services/project-store.server.ts#saveProject`, and redirects to `/projects/:id`.
2. `services/showrunner.server.ts#generateShowPlan` orchestrates four Qwen-powered agents, each validating its own JSON with Zod:
   - `agents/story-agent.server.ts` — brief → `StoryPackage` (concept, hook, voice-over)
   - `agents/director-agent.server.ts` — brief + story → `DirectedScene[]` (5 fixed scenes with visuals/durations)
   - `agents/prompt-agent.server.ts` — scenes → `StoryboardScene[]` (adds a Wan-ready `videoPrompt` per scene)
   - `agents/editor-agent.server.ts` — storyboard → `EditorPackage` (timeline, caption, CTA)
3. Failures bubble to the `/generate` action, which shows an error instead of saving a project.
4. `routes/projects.tsx` lists saved projects; `routes/projects.$projectId.tsx` shows one project's full plan and drives Wan video generation for scene 1 only (`intent=create-video-task` / `intent=refresh-video-task` form actions call `services/wan-video.server.ts`, and job state is stored via `services/project-store.server.ts#saveVideoJob`). Only scene 1 gets a video job by design, to keep the MVP cheap and predictable.

### Storage

`services/project-store.server.ts` persists to a SQLite database at `data/app.db` using Node's built-in `node:sqlite` (`DatabaseSync`) — no external dependency or native module needed. Two tables: `projects` (id, created_at, `show_plan` stored as a JSON blob — the `ShowPlan` shape isn't normalized) and `video_jobs` (one row per project+scene, upserted via `ON CONFLICT`). On first run, if `projects` is empty and a legacy `data/projects.json` file exists, it's auto-imported (one-time migration from the earlier JSON-file-based store). Uploaded images are written to `uploads/` on local disk and served back through `routes/uploads.$filename.tsx`, which guards against path traversal by rejecting filenames containing `/` or `..`. Both `data/` and `uploads/` are gitignored.

### Types

`app/types/showrunner.ts` is the shared contract (`ProductBrief`, `StoryPackage`, `DirectedScene`, `StoryboardScene`, `EditorPackage`, `ShowPlan`) that the Qwen agents and route UIs depend on — check this file first when changing the shape of generated data.

### Route conventions

Routes are registered explicitly in `app/routes.ts` (not filesystem-based) using `@react-router/dev/routes`. `.server.ts` suffixes mark server-only modules, agents, and services that must not be imported from client-rendered code.
