# DramaCommerce AI

DramaCommerce AI is an AI showrunner for short product drama videos. A merchant uploads one product image and a short brief, then the app analyzes the photo, generates a story concept, hook, voice-over, storyboard, video prompts, editing timeline, and a full 5-scene narrated video clip using Qwen/Wan/DashScope TTS on Alibaba Cloud, stitched into one final drama video with ffmpeg.

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
- Pluggable media storage: local disk (`uploads/`) for development, or Alibaba Cloud OSS for production — set via `MEDIA_STORAGE_DRIVER`
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

Run all three background processes in separate terminals — the outbox dispatcher, show plan generation, and video:

```bash
pnpm run worker:outbox
pnpm run worker:showrunner
pnpm run worker:video
```

The video worker shells out to `ffmpeg` to stitch the 5 scene clips into a final video, so it must be installed locally (e.g. `apt-get install ffmpeg`, `brew install ffmpeg`) — the Docker image already includes it.

> **Without these running, both "Generate Product Video" and "Generate 5 Scene Videos" clicks stay stuck forever.**
> The web app never talks to Redis/BullMQ directly — form submissions write
> a Postgres row plus a pending `outbox_events` row in one transaction.
> `worker:outbox` is what actually publishes those to Redis/BullMQ;
> `worker:showrunner` and `worker:video` are what pick the published jobs
> up and call Qwen/Wan. This is four processes by design (see
> [Deployment Notes](#deployment-notes)), not a bug — if generation looks
> frozen, check whether the outbox dispatcher is running (`/health`'s
> `outbox` check flags a stuck backlog) before assuming the provider itself
> is slow.

## Environment Variables

```env
DATABASE_URL=postgresql://dramacommerce:dramacommerce@localhost:5432/dramacommerce
REDIS_URL=redis://localhost:6379

MEDIA_STORAGE_DRIVER=local
OSS_REGION=oss-ap-southeast-1
OSS_BUCKET=your-bucket-name
OSS_ACCESS_KEY_ID=xxxxx
OSS_ACCESS_KEY_SECRET=xxxxx
OSS_ENDPOINT=
OSS_PUBLIC_BASE_URL=
OSS_SIGNED_URL_EXPIRES_SECONDS=3600

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

`MEDIA_STORAGE_DRIVER=local` (default) stores product images, narrated scene clips, and stitched final videos under `uploads/` on local disk, served back through the `/uploads/*` route — the web app, showrunner worker, and video worker must then share that directory (e.g. a mounted volume) if they run as separate containers, since each only sees its own local filesystem otherwise. `MEDIA_STORAGE_DRIVER=oss` instead stores every generated/uploaded file in Alibaba Cloud OSS via the `OSS_*` vars, which every container reaches over the network — no shared volume needed, and the recommended mode for a multi-container production deployment. Objects are private by default and served through short-lived signed URLs generated per request (`OSS_SIGNED_URL_EXPIRES_SECONDS`, default 3600) — nothing extra to configure on the bucket. Set `OSS_PUBLIC_BASE_URL` only if the bucket is deliberately public-read (its own ACL/CDN setup) and you'd rather serve plain, non-expiring URLs than signed ones. See [Docker](#docker) for the shared-volume-vs-OSS tradeoff in a multi-container deployment.

`QWEN_BASE_URL` includes `/compatible-mode/v1` because it is used for OpenAI-compatible chat completions. `QWEN_VISION_MODEL` reuses the same base URL/key for the Analyze Agent's image understanding call.

`WAN_VIDEO_I2V_MODEL` is used instead of `WAN_VIDEO_MODEL`, on the same Wan endpoint, for scenes the Director Agent marks as reference-eligible — Wan then animates directly from the real uploaded product photo instead of text alone. Product reference mode defaults to Auto, can be forced when the merchant intentionally uploads a clean packshot, or disabled for text-to-video-only rendering.

`WAN_VIDEO_RESOLUTION=720P` renders 9:16 as 720x1280 by default. Use `WAN_VIDEO_RESOLUTION=1080P` for 1080x1920 portrait output when provider quota and latency allow it. The project-level aspect ratio is selected in Advanced settings and passed to Wan per video job.

`DASHSCOPE_VIDEO_BASE_URL` does not include `/compatible-mode/v1` because the Wan video API uses `/api/v1/services/...` and `/api/v1/tasks/...`. `DASHSCOPE_TTS_BASE_URL` uses the same style and is usually the same value as `DASHSCOPE_VIDEO_BASE_URL` (same DashScope workspace), kept as a separate var per DashScope surface.

## Development Commands

```bash
pnpm dev
pnpm run worker:outbox
pnpm run worker:showrunner
pnpm run worker:video
pnpm run db:migrate
pnpm run db:generate
pnpm run typecheck
pnpm run build
pnpm run start
pnpm run test
```

- `pnpm dev` starts the React Router dev server.
- `pnpm run worker:outbox` runs the outbox dispatcher — the only process that publishes to Redis/BullMQ. Polls Postgres for pending `outbox_events` rows, claims each with `FOR UPDATE SKIP LOCKED` (safe to run multiple instances), and marks an event delivered only after BullMQ confirms the add. See [Reliability & Idempotency](#reliability--idempotency).
- `pnpm run worker:showrunner` runs the Analyze/Story/Director/Prompt/Critic/Editor agent pipeline as a background job (via `tsx`, importing the app's own agent code directly rather than duplicating it). In production this same source is instead run pre-compiled — see [Docker](#docker).
- `pnpm run worker:video` processes Redis/BullMQ Wan video jobs.
- `pnpm run db:migrate` applies Drizzle migrations to Postgres.
- `pnpm run db:generate` generates a new Drizzle migration after schema changes.
- `pnpm run typecheck` regenerates route types and runs TypeScript.
- `pnpm run build` creates the production build.
- `pnpm run start` serves the production build.
- `pnpm run test` runs unit tests: the media storage abstraction (local + OSS drivers, against a fake OSS client), the outbox/idempotency behavior (transactional rollback, dispatcher retry/locking, stale-generation guards, cleanup) against a real local Postgres, the shared external-request utility (timeout/abort, bounded reads, streaming-download size limits + partial-file cleanup, HTTP status → retry-category classification, secret sanitization — against local fake HTTP servers, not real provider calls) and its plain-JS mirror, and BullMQ's `UnrecoverableError` retry-skipping behavior against a real local Redis. See [External Request Timeouts & Retry Classification](#external-request-timeouts--retry-classification).

## Architecture

```text
User
  ↓
React Router full-stack app
  ├─ /projects/new product brief form
  │    └─ Postgres transaction: showrunner_jobs row + outbox_events row (commit atomically)
  ├─ worker:outbox dispatcher → publishes to Redis/BullMQ (deterministic jobId)
  ├─ Redis/BullMQ showrunner queue → worker:showrunner (Analyze/Story/Director/Prompt/Critic/Editor agents)
  ├─ /projects/new/:jobId live Agent Timeline (polls showrunner_jobs status)
  ├─ Postgres project store
  ├─ worker:outbox dispatcher → Redis/BullMQ video queue → worker:video (Render/Stitch)
  ├─ media storage (local disk or Alibaba Cloud OSS — MEDIA_STORAGE_DRIVER)
  └─ /projects/:id project detail
       ├─ Agent Timeline (Analyze…Editor always done, Render/Stitch live)
       ├─ storyboard + video prompts
       └─ Wan per-scene video tasks + final stitch
              ↓
        Alibaba Cloud Model Studio / DashScope
```

The showrunner flow is split into six Qwen-powered stages: Analyze Agent (vision), Story Agent, Director Agent, Prompt Agent, Critic Agent, and Editor Agent. Each stage returns structured JSON and validates it before the next stage runs. Qwen failures fail closed and do not create mock projects. `/projects/new`'s action no longer runs these stages inline, and no longer enqueues a BullMQ job directly either — it writes a `showrunner_jobs` row and a matching `outbox_events` row in one Postgres transaction (see [Reliability & Idempotency](#reliability--idempotency)); `worker:outbox` is what actually publishes to BullMQ. `worker:showrunner` runs `generateShowPlan` stage by stage, writing status back after each stage so `/projects/new/:jobId` can show live progress. On success it saves the project and marks the job SUCCEEDED in one transaction, and the job redirects there; on failure (retries exhausted) it records the error and cleans up the uploaded image, same as the old synchronous failure path.

Right after the Story Agent completes, a compact **Story Bible** (product facts, visual style, story core, constraints) is built once and reused by every downstream agent instead of re-serializing the full brief/analysis/story objects into each prompt — the Director, Prompt, Critic, and Editor agents only need a handful of those fields, not all of them repeated five times. Every Qwen call also reports its token usage, aggregated per stage and shown on the project page so the pipeline's cost is a real number, not just a claim.

DramaCommerce AI also uses a custom internal skill layer to augment the Qwen-powered showrunner agents with commerce reasoning, product image analysis, brand voice adaptation, prompt safety checks, and video-readiness validation. These skills live under `app/services/skills/` and provide deterministic context or warnings before the agents write final creative output.

The Analyze Agent looks at the actual product photo and returns category/colors/material/branding/quality, which grounds the Story and Director agents instead of them guessing from the text brief alone. The Director Agent uses that analysis to decide, per scene, whether the real photo is a good fit as Wan's literal first frame (`useProductReference`) — normally only the final hero/reveal scene, since forcing a static photo onto an unrelated action shot produces broken video. The Critic Agent reviews the finished storyboard, including sanity-checking those reference-image choices, and can trigger exactly one revision pass before the plan is saved.

Wan video generation is queued the same way. The web app stores video job state in Postgres and enqueues work in Redis/BullMQ, including each scene's `useProductReference` flag. The `worker:video` process creates Wan tasks (text-to-video by default, or image-to-video with the real uploaded photo when `useProductReference` is true), schedules polling jobs, and updates status, task IDs, attempts, video URLs, and provider errors.

The shared `AgentTimeline` component (`app/components/agent-timeline.tsx`) renders all 8 stages (Analyze, Story, Director, Prompt, Critic, Editor, Render, Stitch) and is used on both `/projects/new/:jobId` (for the first 6, live, vertical layout) and `/projects/:id` (for all 8 — the first 6 always "done" since a project only exists once they succeed, Render/Stitch reflecting live `video_jobs`/`final_videos` state, rendered as a horizontal stepper in a full-width section).

## Reliability & Idempotency

HTTP routes never call BullMQ. Every "start work" action (showrunner generation, scene render, final stitch) writes its domain-state row (`showrunner_jobs`/`video_jobs`/`final_videos`) and a matching `outbox_events` row in **one Postgres transaction** — either both exist or neither does, so a Redis outage at submission time can never leave a database row with no corresponding queue message. `worker:outbox` is the only process that calls `queue.add()`, using each outbox event's `job_key` as BullMQ's deterministic `jobId` — publishing the same logical event twice (a dispatcher retry after an uncertain prior attempt) is a safe no-op, not a duplicate job.

Duplicate HTTP submissions (double-click, browser back-button resubmit) are handled at the database layer, not just disabled buttons in the UI:

- **Showrunner generation** — `/projects/new`'s loader mints an idempotency token embedded in a hidden form field; it becomes the `showrunner_jobs.id` itself, so a duplicate POST hits a primary-key conflict and is treated as a replay of the original submission instead of a new job.
- **Scene generation / stitching** — `video_jobs`/`final_videos` gain a `generation_id`/`stitch_generation_id`, minted fresh only when a *new* generation actually starts. A single atomic `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE status NOT IN (active statuses)` means a duplicate click while a generation is already active is a no-op that returns the existing row; a deliberate regenerate after the previous one finished (terminal status) always proceeds with a fresh generation id.

Every provider-call/state-write in the video worker is scoped to the `generation_id`/`stitch_generation_id` from its job payload via conditional `UPDATE ... WHERE ... AND generation_id = $x`, checking the affected row count. If a scene is regenerated while an older queued/polling job for it is still in flight, that older job's writes affect 0 rows — it logs, and exits successfully without calling Wan or touching the newer generation's state. The showrunner worker exits immediately (no Qwen calls, no second project) if a job's status is already `SUCCEEDED` when delivered again; project creation and the `SUCCEEDED` status update commit in one transaction so a worker crash between the two can't happen.

**Known limitation:** a worker crashing *after* calling Wan but *before* saving the returned `task_id` cannot be made atomic with Postgres — BullMQ's at-least-once redelivery will retry and, with no record of the first task, may call Wan again. This is mitigated (not eliminated) by a conditional `QUEUED → RUNNING` transition before the Wan call: a fast retry finds the row already `RUNNING` and skips re-calling Wan by default; `WAN_TASK_STALE_RUNNING_GRACE_MS` (default 5 minutes) bounds how long a genuinely stuck job waits before a retry is allowed to proceed anyway. `video.poll` jobs are deliberately *not* routed through the outbox — they're a worker's own continuation of a job it already owns (self-rescheduled via BullMQ `delay`, same as before), and routing a 30-second polling loop through outbox-insert → dispatcher-pickup → publish would add latency for no correctness benefit; the same conditional-`UPDATE`-with-`generation_id` guard fully covers the "stale poll must not overwrite a newer generation" requirement regardless of how the poll job was enqueued.

`outbox_events` retention is handled by the dispatcher itself (`OUTBOX_CLEANUP_INTERVAL_MS`): delivered events are deleted after `OUTBOX_DELIVERED_RETENTION_MS` (default 24h), permanently failed events after `OUTBOX_FAILED_RETENTION_MS` (default 14d) — see `.env.example`.

## External Request Timeouts & Retry Classification

Every server/worker call to Qwen, Wan, DashScope TTS, OSS, or a remote media URL goes through a shared request utility — `app/services/http/http-client.server.ts` for TS code (Qwen, the OSS driver), mirrored in `scripts/lib/http-client.mjs` for `worker:video` (which, like the rest of that script, runs via plain `node` and can't import TS modules — see the note on that duplication pattern above). Both give every call:

- a caller-supplied timeout via `AbortSignal.timeout`, covering connect, headers, **and** body read as one budget (a slow-drip response body can't outlast a fast-connecting one);
- a bounded response read (JSON calls) or a true streaming download with a hard byte cap (media downloads) — never buffering an unbounded body into memory;
- a content-length pre-check (rejects immediately, before touching the body, when the provider declares a size over the limit) plus a byte-counting `Transform` stream that stops mid-download and deletes the partial file the instant the cap is exceeded, even with no content-length header (chunked transfer);
- a manual, capped redirect loop (default 5 hops) that re-validates the URL protocol on every hop — `https:` always allowed, `http:` only outside production unless explicitly overridden — rather than trusting `fetch`'s built-in redirect-follow, which exposes no hop limit or per-hop inspection;
- a normalized `ExternalRequestError` with a `category` (`timeout`, `network`, `rate_limit`, `auth_config`, `server_temporary`, `invalid_response`, `oversized_response`, `permanent_client`) and a `retryable` boolean, instead of an ad hoc message string every caller has to re-parse;
- sanitized error text — bearer tokens, DashScope-style API keys, and OSS/AWS-style signed-URL query params (`Signature=`, `OSSAccessKeyId=`, ...) are redacted and the message truncated before it can reach a log line or a `error_message` database column.

Timeout/size defaults (all in `.env.example`, all validated at first use — unset uses the default, but a non-numeric/zero/negative/absurdly-large value throws at startup instead of silently running with no timeout): `QWEN_REQUEST_TIMEOUT_MS` (60s), `QWEN_VISION_REQUEST_TIMEOUT_MS` (45s), `WAN_CREATE_TIMEOUT_MS` (30s), `WAN_POLL_TIMEOUT_MS` (15s), `TTS_REQUEST_TIMEOUT_MS` (60s), `MEDIA_DOWNLOAD_TIMEOUT_MS` (120s) / `MEDIA_DOWNLOAD_MAX_BYTES` (200MB), `OSS_REQUEST_TIMEOUT_MS` (10s), `HEALTH_CHECK_TIMEOUT_MS` (5s, bounds each `/health` dependency check independently — see below). Generation calls get longer budgets than status polling; `/health` gets the shortest budget of all, since it should fail fast rather than wait as long as a real generation call would.

**Retry classification** — `video-worker.mjs` and `showrunner-worker.mts` both classify the error they caught before deciding how to fail a job: `timeout`/`network`/`rate_limit`/`server_temporary` (HTTP 408/429/500/502/503/504, connection failures, and their OSS-SDK equivalents) are left to BullMQ's normal `attempts`/`backoff` retry; `auth_config`/`permanent_client`/`invalid_response`/`oversized_response` (401/403, other 4xx, invalid URL protocol, a malformed response that retrying won't fix, a response over the size cap, or missing required configuration like an unset API key) are thrown as BullMQ's `UnrecoverableError` instead — BullMQ special-cases this to fail the job immediately regardless of how many attempts remain, so a bad API key doesn't burn N useless retries (and N real provider calls) before the job is finally marked `FAILED`. The one exception: a malformed/empty JSON body from Qwen's own *generative* output (not a transport-level error) is left retryable, since a second sampling could plausibly produce valid JSON where the transport layer already succeeded.

**Wan task-creation timeout ambiguity**: a timeout while *creating* a Wan task is inherently ambiguous — the provider may have already accepted and started the task before the client gave up waiting, and Wan's API offers no idempotency key to detect that server-side. This isn't new machinery added for timeouts specifically — it's the pre-existing `claimGenerationForWanCall` guard (see [Reliability & Idempotency](#reliability--idempotency)) doing exactly what it was built for: the row is flipped `QUEUED → RUNNING` *before* the Wan call, so a timeout (now classified retryable, triggering a normal BullMQ redelivery) re-enters `createWanTask`, finds the row already `RUNNING`, and skips calling Wan again within `WAN_TASK_STALE_RUNNING_GRACE_MS` — trading a small residual duplicate-call risk (once that grace period elapses) for never leaving a job stuck forever. No unlimited replacement tasks are ever created.

`/health` bounds each dependency check (database, redis, storage, ffmpeg, outbox) independently against `HEALTH_CHECK_TIMEOUT_MS` via `app/services/http/with-timeout.server.ts` — a `Promise.race` against a timer, since `pg`/`ioredis`/`ali-oss` don't expose a clean way to forcibly cancel a call already in flight. A hung dependency makes that one check report `error` (`"<label> check timed out after <N>ms."`) within the bound instead of hanging the whole endpoint; the abandoned call itself is left to resolve or hit its own driver-level timeout in the background.

## Docker

```bash
docker build -t dramacommerce-ai .
docker run --rm --env-file .env dramacommerce-ai pnpm run db:migrate
docker run -d --name dramacommerce-ai --env-file .env -p 3000:3000 dramacommerce-ai
docker run -d --name dramacommerce-ai-outbox --env-file .env dramacommerce-ai pnpm run start:outbox
docker run -d --name dramacommerce-ai-video-worker --env-file .env dramacommerce-ai pnpm run worker:video
docker run -d --name dramacommerce-ai-showrunner-worker --env-file .env dramacommerce-ai pnpm run start:worker
```

`pnpm run start:worker`/`start:outbox` run the showrunner worker and outbox dispatcher from standalone JS bundles (`build/worker/showrunner-worker.mjs`, `build/worker/outbox-dispatcher.mjs`) produced at image build time by `pnpm run build` (esbuild, bundling each script and its `~/services`/`~/agents` imports into one file with `node_modules` packages left external). Neither needs TypeScript, `~/*` path aliases, or a copy of `app/`/`tsconfig.json` at runtime — only the production image's `node_modules` and the compiled bundle. Local development uses `pnpm run worker:showrunner`/`worker:outbox` (via `tsx`, importing the TS source directly) for fast iteration.

**Without the outbox container running, nothing ever reaches Redis/BullMQ** — see the note in [Local Setup](#local-setup). It has no media-storage dependency and needs no volume mount.

**The web, video-worker, and showrunner-worker containers do not share a filesystem by default**, which matters for media: the web app saves uploaded product images, the showrunner worker reads them back for the Analyze Agent's vision call, and the video worker saves narrated scene clips and the stitched final video that the web app then serves. With the default `MEDIA_STORAGE_DRIVER=local`, that only works if all three containers mount the *same* `uploads/` directory:

```bash
docker volume create dramacommerce-uploads

docker run -d --name dramacommerce-ai --env-file .env -p 3000:3000 \
  -v dramacommerce-uploads:/app/uploads dramacommerce-ai
docker run -d --name dramacommerce-ai-video-worker --env-file .env \
  -v dramacommerce-uploads:/app/uploads dramacommerce-ai pnpm run worker:video
docker run -d --name dramacommerce-ai-showrunner-worker --env-file .env \
  -v dramacommerce-uploads:/app/uploads dramacommerce-ai pnpm run start:worker
```

On a single host (e.g. one ECS instance running all three containers, or `docker compose`) a shared named volume like this is enough. Across multiple hosts — or if you'd simply rather not manage a shared volume — set `MEDIA_STORAGE_DRIVER=oss` and the matching `OSS_*` vars instead: every container then reads/writes the same Alibaba Cloud OSS bucket over the network, no volume required, and it's the mode this app is built to run in without change. Forgetting either (no shared volume *and* `MEDIA_STORAGE_DRIVER=local`) is the single biggest cause of "the worker can't find the uploaded image" errors in a multi-container deployment.

## Product Flow

1. Open `/projects/new`.
2. Upload a product image and submit a product brief with optional audience, benefits, offer, platform, mood, duration, and aspect ratio.
3. The brief is queued and you land on `/projects/new/:jobId`, a live Agent Timeline showing Analyze → Story → Director → Prompt → Critic → Editor as each one runs. If Qwen is unavailable, generation fails without creating a mock project.
4. Once all six stages succeed, the page redirects to the saved project at `/projects/:id`.
5. Click **Generate 5 Scene Videos** or generate an individual scene.
6. The project page auto-refreshes scene and final-video status (shown as the Render/Stitch stages of the same timeline) while Wan jobs are in progress.
7. Once all scene videos succeed, click **Stitch Final Video** to create the downloadable product drama video.

## Deployment Notes

Production runs (at least) four processes, all from the same Docker image: **web**, **showrunner worker**, **video worker**, and the **outbox dispatcher**. Deploy each as a separate container process on Alibaba Cloud ECS. Use managed Postgres-compatible storage for `DATABASE_URL` and managed Redis/Tair for `REDIS_URL`. For media, set `MEDIA_STORAGE_DRIVER=oss` with the `OSS_*` vars (recommended — no shared filesystem needed across containers/hosts) or provision persistent shared storage for `uploads/` if staying on `MEDIA_STORAGE_DRIVER=local` (see [Docker](#docker)). The outbox dispatcher can run more than one replica safely (`FOR UPDATE SKIP LOCKED` — see [Reliability & Idempotency](#reliability--idempotency)) if you want redundancy.

Production checklist:

- Store `.env` as server-side secrets and never commit it — this includes `OSS_ACCESS_KEY_ID`/`OSS_ACCESS_KEY_SECRET` if using OSS.
- Run `pnpm run db:migrate` before starting web or worker processes.
- Put the web app behind HTTPS before using real merchant data.
- Back up the Postgres database.
- Configure log collection for Qwen, Wan, upload, worker, storage, and outbox-dispatcher errors — dispatcher logs include the outbox event id, `job_key`, queue, and job name for every dispatch attempt/outcome, and the video worker's stale-generation logs are prefixed `[stale]` with project/scene/generation identifiers.
- If using `MEDIA_STORAGE_DRIVER=oss`, switching an existing `local`-mode deployment over does not retroactively migrate already-uploaded files — old `/uploads/...` records keep working only as long as that deployment stays on `local` mode.
- Use `/health` for uptime checks; it returns `200` when Postgres, Redis, required environment variables, `ffmpeg`, storage (local directory writability, or OSS config + connectivity), and the outbox (no stuck pending backlog — `OUTBOX_HEALTH_STALE_THRESHOLD_SECONDS`) are ready, and `503` when a dependency fails. Each dependency check is individually bounded by `HEALTH_CHECK_TIMEOUT_MS` (default 5s — see [External Request Timeouts & Retry Classification](#external-request-timeouts--retry-classification)), so a hung Postgres/Redis/OSS connection makes that one check report `error` rather than making the whole endpoint hang. The outbox check also reports `pendingCount`/`oldestPendingAgeSeconds`/`failedCount` (counts only, never payloads) as a proxy for dispatcher liveness, since there's no direct way to ping a separate process.
