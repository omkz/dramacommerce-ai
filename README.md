# DramaCommerce AI

DramaCommerce AI is an AI showrunner for short product drama ads. A merchant uploads one product image and a short brief, then the app generates a story concept, hook, voice-over, storyboard, video prompts, editing timeline, and a first real video clip using Qwen/Wan on Alibaba Cloud.

## Features

- Product brief form with image upload
- Qwen-powered multi-agent showrunner pipeline
- Structured 5-scene storyboard and editing timeline
- Postgres project and video job persistence
- Redis/BullMQ background queue for Wan video jobs
- Local image storage in `uploads/`
- Wan text-to-video task creation for Scene 1
- Worker-driven video task polling and video preview
- Dockerfile ready for Alibaba Cloud ECS

## Tech Stack

- React Router 8
- React 19
- Tailwind CSS 4
- TypeScript
- Qwen / Alibaba Cloud Model Studio compatible chat API
- Wan / DashScope video generation API
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

Run the video worker in a second terminal when testing Wan video generation:

```bash
pnpm run worker:video
```

> **Without this running, "Generate Video" clicks stay stuck at `QUEUED` forever.**
> The web app only enqueues a Redis/BullMQ job; a separate `worker:video`
> process is what actually calls the Wan API and polls task status. This is
> two processes by design (see [Deployment Notes](#deployment-notes)), not a
> bug — if a video job looks frozen, check whether the worker is running
> before assuming Wan itself is slow.

## Environment Variables

```env
DATABASE_URL=postgresql://dramacommerce:dramacommerce@localhost:5432/dramacommerce
REDIS_URL=redis://localhost:6379

DASHSCOPE_API_KEY=sk-xxxxx
QWEN_BASE_URL=https://YOUR_WORKSPACE_ID.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-plus

DASHSCOPE_VIDEO_BASE_URL=https://YOUR_WORKSPACE_ID.ap-southeast-1.maas.aliyuncs.com
WAN_VIDEO_MODEL=wan2.1-t2v-turbo
WAN_VIDEO_RESOLUTION=720P
WAN_VIDEO_RATIO=9:16
WAN_VIDEO_DURATION=5
```

`QWEN_BASE_URL` includes `/compatible-mode/v1` because it is used for OpenAI-compatible chat completions.

`DASHSCOPE_VIDEO_BASE_URL` does not include `/compatible-mode/v1` because the Wan video API uses `/api/v1/services/...` and `/api/v1/tasks/...`.

## Development Commands

```bash
pnpm dev
pnpm run worker:video
pnpm run db:migrate
pnpm run db:generate
pnpm run typecheck
pnpm run build
pnpm run start
```

- `pnpm dev` starts the React Router dev server.
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
  ├─ /generate product brief form
  ├─ Qwen multi-agent showrunner pipeline
  ├─ Postgres project store
  ├─ Redis/BullMQ video queue
  ├─ local image uploads
  └─ /projects/:id project detail
       ├─ storyboard
       ├─ video prompts
       └─ Wan Scene 1 video task
              ↓
        Alibaba Cloud Model Studio / DashScope
```

The showrunner flow is split into four Qwen-powered stages: Story Agent, Director Agent, Prompt Agent, and Editor Agent. Each stage returns structured JSON and validates it before the next stage runs. Qwen failures fail closed and do not create mock projects.

Wan video generation is queued. The web app stores video job state in Postgres and enqueues work in Redis/BullMQ. The `worker:video` process creates Wan tasks, schedules polling jobs, and updates status, task IDs, attempts, video URLs, and provider errors.

## Docker

```bash
docker build -t dramacommerce-ai .
docker run --rm --env-file .env dramacommerce-ai pnpm run db:migrate
docker run -d --name dramacommerce-ai --env-file .env -p 3000:3000 dramacommerce-ai
docker run -d --name dramacommerce-ai-video-worker --env-file .env dramacommerce-ai pnpm run worker:video
```

## Product Flow

1. Open `/generate`.
2. Upload a product image and submit a product brief.
3. The app generates a showrunner plan using Qwen. If Qwen is unavailable, generation fails without creating a mock project.
4. The result is saved as a project and shown at `/projects/:id`.
5. Click **Generate Video for Scene 1**.
6. Click **Refresh Video Status** until the Wan task succeeds.
7. The generated video appears in the project page.

## Deployment Notes

Deploy the web app and video worker as separate container processes on Alibaba Cloud ECS. Use managed Postgres-compatible storage for `DATABASE_URL`, managed Redis/Tair for `REDIS_URL`, and persistent storage for `uploads/` until media is moved to Alibaba OSS.

Production checklist:

- Store `.env` as server-side secrets and never commit it.
- Run `pnpm run db:migrate` before starting web or worker processes.
- Put the web app behind HTTPS before using real merchant data.
- Back up the Postgres database.
- Configure log collection for Qwen, Wan, upload, worker, and storage errors.
- Move uploaded product images and generated video assets to Alibaba OSS as usage grows.
- Use `/health` for uptime checks; it returns `200` when Postgres and Redis are reachable and `503` when either dependency fails.
