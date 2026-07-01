# Operations

## Runtime Configuration

Required infrastructure configuration:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
REDIS_URL=redis://HOST:6379
```

Required Qwen configuration:

```env
DASHSCOPE_API_KEY=sk-xxxxx
QWEN_BASE_URL=https://YOUR_WORKSPACE_ID.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-plus
```

Required Wan video configuration:

```env
DASHSCOPE_VIDEO_BASE_URL=https://YOUR_WORKSPACE_ID.ap-southeast-1.maas.aliyuncs.com
WAN_VIDEO_MODEL=wan2.1-t2v-turbo
WAN_VIDEO_RESOLUTION=720P
WAN_VIDEO_RATIO=9:16
WAN_VIDEO_DURATION=5
```

Keep `.env` server-side only. Do not expose these values to client bundles or commit them to git.

## Storage

The current deployment stores projects and video job metadata in Postgres. Uploaded images are still stored in `uploads/`; mount this path on persistent storage until media is moved to object storage.

Run database migrations before starting the web or worker processes:

```bash
pnpm run db:migrate
```

Production storage roadmap:

- Move uploaded product images and generated video assets to Alibaba OSS.
- Use managed Postgres-compatible storage for `DATABASE_URL`.
- Keep `uploads/` out of git and container images.

## Failure Modes

Qwen generation fails closed: no project is saved when the Qwen request, JSON parsing, or stage validation fails. The UI displays a specific error for missing configuration, API failure, invalid response, or schema mismatch.

Wan video generation is task-based. The web app stores a queued video job in Postgres and enqueues work in Redis/BullMQ. The `pnpm run worker:video` process creates Wan tasks, schedules polling jobs, and updates Postgres with status, task IDs, attempts, video URLs, and provider errors.

## Production Roadmap

- Add authenticated merchant accounts and per-store project isolation.
- Generate all storyboard scenes asynchronously.
- Persist video assets to object storage instead of hot-linking provider output.
- Add retry policies and structured server logs for Qwen and Wan calls.
- Add rate limits for generation endpoints.
- Add automated tests for validators, storage, and route actions.
