# Architecture

DramaCommerce AI is a React Router full-stack app with queue-backed AI and video workers. The web app stays responsive by persisting generation state in Postgres and moving long-running Qwen/Wan work to BullMQ workers.

```text
Merchant
  |
  v
React Router app
  |-- /generate product brief form
  |-- showrunner_jobs table
  |-- Redis/BullMQ showrunner queue
  |     `-- worker:showrunner
  |         |-- Analyze Agent
  |         |-- Story Agent
  |         |-- Director Agent
  |         |-- Prompt Agent
  |         |-- Critic Agent
  |         `-- Editor Agent
  |-- projects table
  |-- Redis/BullMQ video queue
  |     `-- worker:video
  |         |-- Wan scene render
  |         |-- Wan task polling
  |         `-- ffmpeg final stitch
  `-- /projects/:id
        |-- Product Analysis
        |-- Agent Timeline
        |-- Storyboard
        `-- Final ad output
```

## Showrunner Pipeline

The showrunner has six Qwen-powered stages:

1. Analyze Agent reads the product photo and returns category, colors, material, branding visibility, photo quality, reference suitability, and issues.
2. Story Agent writes the concept, hook, and voice-over grounded in that product analysis.
3. Director Agent blocks the five-scene storyboard and chooses `useProductReference` per scene.
4. Prompt Agent writes Wan-ready prompts after reading Wan constraints through the constraints tool.
5. Critic Agent reviews the storyboard and can trigger one bounded prompt revision pass.
6. Editor Agent writes the timeline, social caption, and CTA.

`/generate` creates a `showrunner_jobs` row and enqueues the job. `worker:showrunner` calls `generateShowPlan()` with `onStageChange`, so every stage transition is persisted and `/generate/:jobId` can render live progress. The project is saved only after all six stages succeed.

## Custom Skills

The showrunner agents are augmented by deterministic internal skills in `app/services/skills/`:

- Product Analysis Skill summarizes photo facts, reference suitability, and visual warnings.
- Commerce Angle Skill turns the merchant brief into pain point, desire, objection, and CTA guidance.
- Brand Voice Skill adapts tone to the requested mood and platform.
- Prompt Safety Skill checks Wan prompts for unsupported claims and risky reference-image usage.
- Video Readiness Skill checks scene count, reference-image usage, prompt availability, and short-clip voice-over fit.

These skills do not replace Qwen. They provide structured facts, recommendations, and warnings that Qwen agents must account for, giving the pipeline deterministic commerce and render-readiness checks before creative output is accepted. The video-readiness layer also enforces the product-reference rule by allowing at most one reference-image scene, and none when the image analysis says the photo is not usable.

## Product Reference Decision

The Analyze Agent returns `canUseAsReference`. The Director Agent uses that value plus scene intent to set `useProductReference` per scene. The project page exposes both decisions:

- Product Analysis shows `Product Reference: Usable` or `Not usable`.
- Each storyboard scene shows `Product reference: usable` or `not used`.

That makes image-to-video readiness visible even before render. When `useProductReference` is true, the video worker passes the uploaded product image into the Wan image-to-video path; otherwise it uses text-to-video.

Merchants can choose the product reference mode on the brief form:

- Auto uses the Analyze Agent recommendation.
- Use as packshot forces one hero/reference scene for merchants who intentionally upload a clean centered product photo.
- Disabled keeps every scene text-to-video.

## Persistence

Postgres stores:

- `showrunner_jobs` for queued/running/failed/succeeded showrunner stages.
- `projects` for the generated `ShowPlan`.
- `video_jobs` for per-scene Wan task status, prompts, reference flags, attempts, and output URLs.
- `final_videos` for stitched output status and URL.

Redis/BullMQ stores execution queues only. Provider status and user-visible state are persisted in Postgres so browser refreshes and worker restarts do not erase progress.

## Failure Handling

Qwen failures fail closed: the app records the error and does not create a mock project. Video failures keep the scene job in a failed state with the provider message so the user can regenerate or retry status checks. Uploaded files are cleaned up when project creation fails or a project is deleted.
