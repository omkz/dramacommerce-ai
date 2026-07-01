# DramaCommerce AI

DramaCommerce AI is an AI showrunner for short product drama ads. A merchant uploads one product image and a short brief, then the app generates a story concept, hook, voice-over, storyboard, video prompts, editing timeline, and a first real video clip using Qwen/Wan on Alibaba Cloud.

## Features

- Product brief form with image upload
- Qwen-powered multi-agent showrunner pipeline
- Structured 5-scene storyboard and editing timeline
- Local project persistence in SQLite (`data/app.db`)
- Local image storage in `uploads/`
- Wan text-to-video task creation for Scene 1
- Manual video task polling and video preview
- Dockerfile ready for Alibaba Cloud ECS

## Tech Stack

- React Router 8
- React 19
- Tailwind CSS 4
- TypeScript
- Qwen / Alibaba Cloud Model Studio compatible chat API
- Wan / DashScope video generation API
- SQLite (Node's built-in `node:sqlite`) for local storage

## Local Setup

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Open `http://localhost:5173`.

## Environment Variables

```env
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
pnpm run typecheck
pnpm run build
pnpm run start
```

## Product Direction

DramaCommerce AI is designed as a production-ready creative operations tool for merchants. The current product flow proves the core path: Qwen multi-agent planning, persisted projects, and Wan video generation for the first scene. See `docs/architecture.md` for system design and `docs/operations.md` for production readiness notes.

## Docker

```bash
docker build -t dramacommerce-ai .
docker run --env-file .env -p 3000:3000 dramacommerce-ai
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

Deploy this as a Docker container on Alibaba Cloud ECS for the first production target. For durable production use, mount persistent storage for `data/` and `uploads/`, then migrate media to Alibaba OSS and project data to a managed database as traffic grows.
