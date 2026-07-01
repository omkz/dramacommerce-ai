# Architecture

```text
User
  ↓
React Router full-stack app on Alibaba ECS
  ├─ /generate product brief form
  ├─ Qwen multi-agent showrunner pipeline
  ├─ SQLite project store
  ├─ local image uploads
  └─ /projects/:id project detail
       ├─ storyboard
       ├─ video prompts
       └─ Wan Scene 1 video task
              ↓
        Alibaba Cloud Model Studio / DashScope
```

## Showrunner Pipeline

The showrunner flow is split into four Qwen-powered stages:

1. Story Agent: concept, hook, voice-over
2. Director Agent: five scenes, shot direction, timing
3. Prompt Agent: Wan-ready text-to-video prompts
4. Editor Agent: editing timeline, caption, CTA

Each stage returns structured JSON and validates it before the next stage runs. When Qwen fails or env vars are missing, the app returns an error and does not create a project.

## Video Pipeline

The MVP generates one real video clip first:

```text
Scene 1 videoPrompt
  ↓
createWanTextToVideoTask()
  ↓
save task_id in data/app.db (SQLite)
  ↓
queryWanVideoTask()
  ↓
show video_url in /projects/:id
```

This proves the creative pipeline without spending credits on all five scenes.
