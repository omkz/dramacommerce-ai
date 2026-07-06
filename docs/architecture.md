# Architecture

DramaCommerce AI is a React Router full-stack app with queue-backed AI and video workers. The web app stays responsive by persisting generation state in Postgres and moving long-running Qwen/Wan work to BullMQ workers.

```text
Merchant
  |
  v
React Router app
  |-- /projects/new product brief form
  |-- showrunner_jobs table
  |-- Redis/BullMQ showrunner queue
  |     `-- worker:showrunner
  |         |-- Analyze Agent
  |         |-- Story Agent  --> builds Story Bible
  |         |-- Director Agent  (reads Story Bible)
  |         |-- Prompt Agent    (reads Story Bible)
  |         |-- Critic Agent    (reads Story Bible)
  |         `-- Editor Agent    (reads Story Bible)
  |-- projects table (show_plan jsonb incl. tokenUsage)
  |-- Redis/BullMQ video queue
  |     `-- worker:video
  |         |-- Wan scene render
  |         |-- Wan task polling
  |         `-- ffmpeg final stitch
  `-- /projects/:id
        |-- Product Analysis
        |-- Story & Voice-over (Edit)
        |-- Storyboard / Scene Prompts / Generated Videos
        |-- Token Usage
        |-- Agent Timeline (horizontal)
        `-- Final ad output (sticky sidebar)
```

## Showrunner Pipeline

The showrunner has six Qwen-powered stages:

1. Analyze Agent reads the product photo and returns category, colors, material, branding visibility, photo quality, reference suitability, and issues.
2. Story Agent writes the concept, hook, and voice-over grounded in that product analysis.
3. Director Agent blocks the five-scene storyboard and chooses `useProductReference` per scene.
4. Prompt Agent writes Wan-ready prompts after reading Wan constraints through the constraints tool.
5. Critic Agent reviews the storyboard and can trigger one bounded prompt revision pass.
6. Editor Agent writes the timeline, social caption, and CTA — reading the Hook from the Story Bible so the caption riffs on the same line the merchant sees, instead of drifting to its own angle.

`/projects/new` creates a `showrunner_jobs` row and enqueues the job. `worker:showrunner` calls `generateShowPlan()` with `onStageChange`, so every stage transition is persisted and `/projects/new/:jobId` can render live progress. The project is saved only after all six stages succeed.

## Story Bible & Token Usage

Director, Prompt, Critic, and Editor don't each get the full raw `brief`/`analysis`/`story` JSON re-serialized into their prompt — that repeats mostly-irrelevant fields (`imageUrl`, `showProductOverlay`, etc.) across five separate calls. Instead, `buildStoryBible()` (`app/services/story-bible.server.ts`) runs once, right after the Story Agent completes, condensing everything into one compact object:

- `productFacts` — name, category, colors, material, audience, selling points, offer
- `visualStyle` — mood, platform, aspect ratio, photo quality, reference eligibility, reference mode
- `storyCore` — concept, hook, voice-over
- `constraints` — duration

That single object is what gets serialized into the four downstream agents' prompts. Raw `brief`/`analysis` are still passed into those agent functions where needed, but only for local skill computation (`services/skills/*`) — that's pure code, not something re-sent to Qwen.

Every Qwen call also reports token usage: `callQwenJson`/`callQwenVisionJson` (`app/services/qwen.server.ts`) accept an `onUsage` callback, summing prompt/completion/total tokens across BullMQ tool-calling rounds. `generateShowPlan` tags each call with its stage and model, and the aggregated list is saved as `ShowPlan.tokenUsage` — shown as a table on the project detail page (stage, model, prompt/completion/total tokens, plus a totals row).

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
- The Storyboard overview badges the one scene (if any) the Director actually picked with `Uses product photo` — the common case is zero or one badge, since at most one scene should ever be reference-eligible.

That makes image-to-video readiness visible even before render. When `useProductReference` is true, the video worker passes the uploaded product image into the Wan image-to-video path; otherwise it uses text-to-video.

Merchants can choose the product reference mode on the brief form:

- Auto uses the Analyze Agent recommendation.
- Use as packshot forces one hero/reference scene for merchants who intentionally upload a clean centered product photo.
- Disabled keeps every scene text-to-video.

Aspect ratio is also a project-level brief setting. The default is 9:16 portrait for TikTok, Reels, and Shorts; Advanced settings also support 1:1 for Instagram Feed and 16:9 for YouTube. The chosen ratio is passed to the Prompt Agent's Wan constraints tool and to each queued video render job.

## Persistence

Postgres stores:

- `showrunner_jobs` for queued/running/failed/succeeded showrunner stages.
- `projects` for the generated `ShowPlan`.
- `video_jobs` for per-scene Wan task status, prompts, reference flags, attempts, and output URLs.
- `final_videos` for stitched output status and URL.

Redis/BullMQ stores execution queues only. Provider status and user-visible state are persisted in Postgres so browser refreshes and worker restarts do not erase progress.

## Failure Handling

Qwen failures fail closed: the app records the error and does not create a mock project. Video failures keep the scene job in a failed state with the provider message so the user can regenerate or retry status checks. Uploaded files are cleaned up when project creation fails or a project is deleted.
