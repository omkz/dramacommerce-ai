# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

DramaCommerce AI is a React Router 8 full-stack app. A merchant uploads a product image plus a short brief (audience, mood, platform, duration); the app runs a Qwen-powered AI "showrunner" pipeline that produces a story concept, hook, voice-over, a 5-scene storyboard with video prompts, an editing timeline, a social caption/CTA, can kick off real text-to-video renders for each scene via Alibaba Cloud's Wan model (each scene's AI-written voice-over line is synthesized via DashScope TTS and muxed onto the clip), and stitches the 5 successful clips into one final drama ad with ffmpeg.

## Commands

Package manager is **pnpm** (see `pnpm-lock.yaml` and the Dockerfile).

- `pnpm dev` — start the dev server (React Router dev, HMR) at `http://localhost:5173`
- `pnpm run typecheck` — runs `react-router typegen` then `tsc` (regenerate route types before type-checking after changing `app/routes.ts` or route loader/action signatures)
- `pnpm run build` — production build
- `pnpm run start` — serve the production build (`react-router-serve ./build/server/index.js`)

There is no test suite and no lint script configured in `package.json`.

`scripts/video-worker.mjs` (`pnpm run worker:video`) shells out to `ffmpeg` for the final-video stitch step — it must be installed and on `PATH` wherever the worker runs (already handled in the Docker image via `apk add ffmpeg`, but needs a manual install for local dev).

## Environment

Copy `.env.example` to `.env`. Three separate Alibaba Cloud DashScope surfaces are used, each with its own base URL var (even though TTS and Wan usually share the same workspace URL in practice):

- `DASHSCOPE_API_KEY`, `QWEN_BASE_URL` (includes `/compatible-mode/v1` — OpenAI-compatible chat completions), `QWEN_MODEL` — for the showrunner planning step.
- `DASHSCOPE_VIDEO_BASE_URL` (no `/compatible-mode/v1` suffix — uses `/api/v1/services/...` and `/api/v1/tasks/...`), `WAN_VIDEO_MODEL`, `WAN_VIDEO_RESOLUTION`, `WAN_VIDEO_RATIO`, `WAN_VIDEO_DURATION` — for Wan video generation.
- `DASHSCOPE_TTS_BASE_URL` (same `/api/v1/services/...` style), `DASHSCOPE_TTS_MODEL` (default `qwen3-tts-flash`), `DASHSCOPE_TTS_VOICE` (default `Cherry`) — for scene voice-over synthesis. Uses the same `DASHSCOPE_API_KEY`.

If Qwen env vars are missing or the Qwen call fails, generation returns an error and no project is created. Do not reintroduce automatic mock fallback for production generation.

## Architecture

### Pipeline: brief → showrunner → project → video

1. `routes/generate.tsx` (`action`) collects the form/multipart submission, saves the uploaded image via `services/image-upload.server.ts`, calls `services/showrunner.server.ts#generateShowPlan`, persists the result with `services/project-store.server.ts#saveProject`, and redirects to `/projects/:id`.
2. `services/showrunner.server.ts#generateShowPlan` orchestrates four Qwen-powered agents. Each agent validates its JSON through `services/showrunner-validator.server.ts` before the next stage runs:
   - `agents/story-agent.server.ts` — brief → `StoryPackage` (concept, hook, voice-over)
   - `agents/director-agent.server.ts` — brief + story → `DirectedScene[]` (5 fixed scenes with visuals/durations)
   - `agents/prompt-agent.server.ts` — scenes → `StoryboardScene[]` (adds a Wan-ready `videoPrompt` per scene)
   - `agents/editor-agent.server.ts` — storyboard → `EditorPackage` (timeline, caption, CTA)
3. Failures bubble to the `/generate` action, which shows an error instead of saving a project.
4. `routes/projects.tsx` lists saved projects; `routes/projects.$projectId.tsx` shows one project's full plan and drives Wan video generation for any/all scenes (`intent=create-video-task` / `intent=refresh-video-task` / `intent=create-all-video-tasks` form actions call `services/wan-video.server.ts`, job state stored via `services/project-store.server.ts#saveVideoJob`). When `scripts/video-worker.mjs` polls a scene to `SUCCEEDED`, it synthesizes that scene's `voiceOver` line via DashScope TTS and muxes the audio onto the clip with `ffmpeg` before saving — the raw Wan clip has no audio track at all. If TTS or muxing fails, the worker falls back to the silent Wan clip rather than failing the job (the Wan generation cost is already spent). Once all 5 scenes reach `SUCCEEDED`, `intent=create-stitch-task` enqueues a `video.stitch` BullMQ job; the worker downloads the 5 (now-narrated) clips, concatenates them with `ffmpeg` (stream-copy first, re-encode fallback if codecs mismatch), and writes the result to `uploads/`. Stitch status/output is tracked in the `final_videos` table (one row per project) via `services/project-store.server.ts#saveFinalVideo`.

### Storage

`services/project-store.server.ts` persists projects and video jobs to Postgres through Drizzle (`app/db/schema.ts`, `services/db.server.ts`). Migrations live in `drizzle/` and should be applied with `pnpm run db:migrate` before starting web or worker processes. `projects.show_plan` is stored as JSONB, `video_jobs` stores per-scene provider, queue job ID, Wan task ID, status, attempts, polling timestamps, output URL, and error metadata, and `final_videos` stores the stitched-output status/URL per project. Uploaded product images and stitched final videos are written to `uploads/` on local disk and served back through `routes/uploads.$filename.tsx`, which guards against path traversal by rejecting filenames containing `/` or `..`. `uploads/` is gitignored and should move to OSS for production scale.

### Types

`app/types/showrunner.ts` is the shared contract (`ProductBrief`, `StoryPackage`, `DirectedScene`, `StoryboardScene`, `EditorPackage`, `ShowPlan`) that the Qwen agents and route UIs depend on — check this file first when changing the shape of generated data.

### Route conventions

Routes are registered explicitly in `app/routes.ts` (not filesystem-based) using `@react-router/dev/routes`. `.server.ts` suffixes mark server-only modules, agents, and services that must not be imported from client-rendered code.
