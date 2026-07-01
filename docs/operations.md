# Operations

## Runtime Configuration

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

The current deployment stores projects in SQLite at `data/app.db` and uploaded images in `uploads/`. For a single ECS instance, mount both paths on persistent storage and back up `data/app.db`.

Production storage roadmap:

- Move uploaded product images and generated video assets to Alibaba OSS.
- Move project and video job metadata to a managed database.
- Keep `uploads/` and `data/` out of git and container images.

## Failure Modes

Qwen generation fails closed: no project is saved when the Qwen request, JSON parsing, or stage validation fails. The UI displays a specific error for missing configuration, API failure, invalid response, or schema mismatch.

Wan video generation is task-based. The app stores the task ID and status, then refreshes status manually from the project page. Failed Wan tasks should display the provider error message when available.

## Production Roadmap

- Add authenticated merchant accounts and per-store project isolation.
- Queue Wan jobs and generate all storyboard scenes asynchronously.
- Persist video assets to object storage instead of hot-linking provider output.
- Add retry policies and structured server logs for Qwen and Wan calls.
- Add rate limits for generation endpoints.
- Add automated tests for validators, storage, and route actions.
