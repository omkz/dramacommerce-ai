# Architecture

```text
User
  ↓
React Router full-stack app on Alibaba ECS
  ├─ /generate product brief form
  ├─ Qwen showrunner planner
  ├─ SQLite project store
  ├─ local image uploads
  └─ /projects/:id project detail
       ├─ storyboard
       ├─ video prompts
       └─ Wan Scene 1 video task
              ↓
        Alibaba Cloud Model Studio / DashScope
```

## Agent Pipeline

The planning pipeline is intentionally split into showrunner-like stages:

1. Story Agent: concept, hook, voice-over
2. Director Agent: scenes and shot list
3. Prompt Agent: video prompts per scene
4. Editor Agent: timeline, caption, CTA

When Qwen is configured, Qwen generates the structured show plan. When Qwen fails or env vars are missing, the app falls back to the local mock agent pipeline so the demo remains usable.

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
