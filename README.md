# DramaCommerce AI

DramaCommerce AI is an AI showrunner for short product drama ads. A merchant uploads one product image and a short brief, then the app analyzes the photo, generates a story concept, hook, voice-over, storyboard, video prompts, editing timeline, and a full 5-scene narrated video clip using Qwen/Wan/DashScope TTS on Alibaba Cloud, stitched into one final drama ad with ffmpeg.

The multimodal orchestration path is: image → product analysis → script → storyboard → video prompts → Wan video clips → TTS voice-over → ffmpeg final edit.

## Features

- Product brief form with image upload
- Qwen-powered multi-agent showrunner pipeline, run as a background job with a live-updating Agent Timeline UI (Analyze → Story → Director → Prompt → Critic → Editor → Render → Stitch)
- Vision-based Analyze Agent grounds the story in what the photo actually shows (category, colors, material, quality) instead of guessing from text alone
- Custom internal skill layer augments the Qwen agents with commerce angle selection, brand voice guidance, prompt safety checks, and video-readiness validation
- Critic Agent reviews the storyboard before render and can trigger one bounded revision pass
- Compact "Story Bible" context object built once after the Story Agent, reused by every downstream agent instead of re-sending the full brief/analysis/story JSON each time
- Per-agent token usage tracking (prompt/completion/total tokens, aggregated per pipeline stage) shown on the project page
- Merchant-editable Story/Hook/Voice-over and per-scene prompt/voice-over, decoupled from the AI regenerate action — editing text never spends a Wan render, regenerating never requires re-typing text
- Director Agent decides, per scene, whether Wan should animate directly from the real product photo (image-to-video) instead of text alone — only for scenes where that's visually coherent
- Merchant-selectable product reference mode: Auto, force clean packshot/hero reference, or disable image-to-video reference frames
- Output aspect ratio control: 9:16 portrait by default, with 1:1 and 16:9 available in Advanced settings
- Structured 5-scene storyboard and editing timeline
- Postgres project and video job persistence
- Redis/BullMQ background queue for showrunner generation and Wan video jobs
- Local image storage in `uploads/`
- Wan text-to-video and image-to-video task creation for any or all 5 scenes
- DashScope TTS voice-over synthesis muxed onto each scene clip
- Worker-driven video task polling and video preview
- ffmpeg-based stitching of all 5 scene clips into one final video
- Dockerfile ready for Alibaba Cloud ECS

## Tech Stack

- React Router 8
- React 19
- Tailwind CSS 4
- TypeScript
- Qwen / Alibaba Cloud Model Studio compatible chat API
- Wan / DashScope video generation API
- DashScope TTS (qwen3-tts-flash) for scene voice-over
- Postgres for durable application data
- Redis and BullMQ for background jobs

## Local Setup

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres redis
pnpm run db:migrate
pnpm dev
```

Open `http://localhost:5173`.

Health check endpoint:

```text
http://localhost:5173/health
```

Run both workers in separate terminals — one for show plan generation, one for video:

```bash
pnpm run worker:showrunner
pnpm run worker:video
```

The video worker shells out to `ffmpeg` to stitch the 5 scene clips into a final video, so it must be installed locally (e.g. `apt-get install ffmpeg`, `brew install ffmpeg`) — the Docker image already includes it.

> **Without these running, both "Generate Product Ad" and "Generate 5 Scene Videos" clicks stay stuck forever.**
> The web app only enqueues Redis/BullMQ jobs; separate `worker:showrunner`
> and `worker:video` processes are what actually call Qwen/Wan and update
> job status. This is three processes by design (see
> [Deployment Notes](#deployment-notes)), not a bug — if generation looks
> frozen, check whether the relevant worker is running before assuming the
> provider itself is slow.

## Environment Variables

```env
DATABASE_URL=postgresql://dramacommerce:dramacommerce@localhost:5432/dramacommerce
REDIS_URL=redis://localhost:6379

DASHSCOPE_API_KEY=sk-xxxxx
QWEN_BASE_URL=https://YOUR_WORKSPACE_ID.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-plus
QWEN_VISION_MODEL=qwen3-vl-flash

DASHSCOPE_VIDEO_BASE_URL=https://YOUR_WORKSPACE_ID.ap-southeast-1.maas.aliyuncs.com
WAN_VIDEO_MODEL=wan2.1-t2v-turbo
WAN_VIDEO_I2V_MODEL=wan2.1-i2v-turbo
WAN_VIDEO_RESOLUTION=720P
WAN_VIDEO_RATIO=9:16
WAN_VIDEO_DURATION=5

DASHSCOPE_TTS_BASE_URL=https://YOUR_WORKSPACE_ID.ap-southeast-1.maas.aliyuncs.com
DASHSCOPE_TTS_MODEL=qwen3-tts-flash
DASHSCOPE_TTS_VOICE=Cherry
```

`QWEN_BASE_URL` includes `/compatible-mode/v1` because it is used for OpenAI-compatible chat completions. `QWEN_VISION_MODEL` reuses the same base URL/key for the Analyze Agent's image understanding call.

`WAN_VIDEO_I2V_MODEL` is used instead of `WAN_VIDEO_MODEL`, on the same Wan endpoint, for scenes the Director Agent marks as reference-eligible — Wan then animates directly from the real uploaded product photo instead of text alone. Product reference mode defaults to Auto, can be forced when the merchant intentionally uploads a clean packshot, or disabled for text-to-video-only rendering.

`WAN_VIDEO_RESOLUTION=720P` renders 9:16 as 720x1280 by default. Use `WAN_VIDEO_RESOLUTION=1080P` for 1080x1920 portrait output when provider quota and latency allow it. The project-level aspect ratio is selected in Advanced settings and passed to Wan per video job.

`DASHSCOPE_VIDEO_BASE_URL` does not include `/compatible-mode/v1` because the Wan video API uses `/api/v1/services/...` and `/api/v1/tasks/...`. `DASHSCOPE_TTS_BASE_URL` uses the same style and is usually the same value as `DASHSCOPE_VIDEO_BASE_URL` (same DashScope workspace), kept as a separate var per DashScope surface.

## Development Commands

```bash
pnpm dev
pnpm run worker:showrunner
pnpm run worker:video
pnpm run db:migrate
pnpm run db:generate
pnpm run typecheck
pnpm run build
pnpm run start
```

- `pnpm dev` starts the React Router dev server.
- `pnpm run worker:showrunner` runs the Analyze/Story/Director/Prompt/Critic/Editor agent pipeline as a background job (via `tsx`, importing the app's own agent code directly rather than duplicating it).
- `pnpm run worker:video` processes Redis/BullMQ Wan video jobs.
- `pnpm run db:migrate` applies Drizzle migrations to Postgres.
- `pnpm run db:generate` generates a new Drizzle migration after schema changes.
- `pnpm run typecheck` regenerates route types and runs TypeScript.
- `pnpm run build` creates the production build.
- `pnpm run start` serves the production build.

## Architecture

```text
User
  ↓
React Router full-stack app
  ├─ /projects/new product brief form
  ├─ Redis/BullMQ showrunner queue → worker:showrunner (Analyze/Story/Director/Prompt/Critic/Editor agents)
  ├─ /projects/new/:jobId live Agent Timeline (polls showrunner_jobs status)
  ├─ Postgres project store
  ├─ Redis/BullMQ video queue → worker:video (Render/Stitch)
  ├─ local image uploads
  └─ /projects/:id project detail
       ├─ Agent Timeline (Analyze…Editor always done, Render/Stitch live)
       ├─ storyboard + video prompts
       └─ Wan per-scene video tasks + final stitch
              ↓
        Alibaba Cloud Model Studio / DashScope
```

The showrunner flow is split into six Qwen-powered stages: Analyze Agent (vision), Story Agent, Director Agent, Prompt Agent, Critic Agent, and Editor Agent. Each stage returns structured JSON and validates it before the next stage runs. Qwen failures fail closed and do not create mock projects. `/projects/new`'s action no longer runs these stages inline — it creates a `showrunner_jobs` row and enqueues a job; `worker:showrunner` runs `generateShowPlan` stage by stage, writing status back after each stage so `/projects/new/:jobId` can show live progress. On success it saves the project and the job redirects there; on failure (retries exhausted) it records the error and cleans up the uploaded image, same as the old synchronous failure path.

Right after the Story Agent completes, a compact **Story Bible** (product facts, visual style, story core, constraints) is built once and reused by every downstream agent instead of re-serializing the full brief/analysis/story objects into each prompt — the Director, Prompt, Critic, and Editor agents only need a handful of those fields, not all of them repeated five times. Every Qwen call also reports its token usage, aggregated per stage and shown on the project page so the pipeline's cost is a real number, not just a claim.

DramaCommerce AI also uses a custom internal skill layer to augment the Qwen-powered showrunner agents with commerce reasoning, product image analysis, brand voice adaptation, prompt safety checks, and video-readiness validation. These skills live under `app/services/skills/` and provide deterministic context or warnings before the agents write final creative output.

The Analyze Agent looks at the actual product photo and returns category/colors/material/branding/quality, which grounds the Story and Director agents instead of them guessing from the text brief alone. The Director Agent uses that analysis to decide, per scene, whether the real photo is a good fit as Wan's literal first frame (`useProductReference`) — normally only the final hero/reveal scene, since forcing a static photo onto an unrelated action shot produces broken video. The Critic Agent reviews the finished storyboard, including sanity-checking those reference-image choices, and can trigger exactly one revision pass before the plan is saved.

Wan video generation is queued the same way. The web app stores video job state in Postgres and enqueues work in Redis/BullMQ, including each scene's `useProductReference` flag. The `worker:video` process creates Wan tasks (text-to-video by default, or image-to-video with the real uploaded photo when `useProductReference` is true), schedules polling jobs, and updates status, task IDs, attempts, video URLs, and provider errors.

The shared `AgentTimeline` component (`app/components/agent-timeline.tsx`) renders all 8 stages (Analyze, Story, Director, Prompt, Critic, Editor, Render, Stitch) and is used on both `/projects/new/:jobId` (for the first 6, live, vertical layout) and `/projects/:id` (for all 8 — the first 6 always "done" since a project only exists once they succeed, Render/Stitch reflecting live `video_jobs`/`final_videos` state, rendered as a horizontal stepper in a full-width section).

## Docker

```bash
docker build -t dramacommerce-ai .
docker run --rm --env-file .env dramacommerce-ai pnpm run db:migrate
docker run -d --name dramacommerce-ai --env-file .env -p 3000:3000 dramacommerce-ai
docker run -d --name dramacommerce-ai-video-worker --env-file .env dramacommerce-ai pnpm run worker:video
docker run -d --name dramacommerce-ai-showrunner-worker --env-file .env dramacommerce-ai pnpm run worker:showrunner
```

## Product Flow

1. Open `/projects/new`.
2. Upload a product image and submit a product brief with optional audience, benefits, offer, platform, mood, duration, and aspect ratio.
3. The brief is queued and you land on `/projects/new/:jobId`, a live Agent Timeline showing Analyze → Story → Director → Prompt → Critic → Editor as each one runs. If Qwen is unavailable, generation fails without creating a mock project.
4. Once all six stages succeed, the page redirects to the saved project at `/projects/:id`.
5. Click **Generate 5 Scene Videos** or generate an individual scene.
6. The project page auto-refreshes scene and final-video status (shown as the Render/Stitch stages of the same timeline) while Wan jobs are in progress.
7. Once all scene videos succeed, click **Stitch Final Ad** to create the downloadable product drama ad.

## Deployment Notes

Deploy the web app and video worker as separate container processes on Alibaba Cloud ECS. Use managed Postgres-compatible storage for `DATABASE_URL`, managed Redis/Tair for `REDIS_URL`, and persistent storage for `uploads/` until media is moved to Alibaba OSS.

Production checklist:

- Store `.env` as server-side secrets and never commit it.
- Run `pnpm run db:migrate` before starting web or worker processes.
- Put the web app behind HTTPS before using real merchant data.
- Back up the Postgres database.
- Configure log collection for Qwen, Wan, upload, worker, and storage errors.
- Move uploaded product images and generated video assets to Alibaba OSS as usage grows.
- Use `/health` for uptime checks; it returns `200` when Postgres, Redis, required environment variables, and `ffmpeg` are ready, and `503` when a dependency fails.
