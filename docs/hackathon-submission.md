# Qwen Cloud Hackathon Submission Notes

## Track

Submit DramaCommerce AI under **Track 2: AI Showrunner**. The app demonstrates a Qwen-powered short drama creation pipeline for merchants: product brief, story development, scene direction, text-to-video prompts, editing plan, and Wan video generation for Scene 1.

## Demo Flow

1. Open `/generate`.
2. Upload a product image and enter product name, audience, mood, platform, and duration.
3. Submit the form to run the Qwen multi-agent showrunner pipeline.
4. Open the generated project page and show the concept, hook, voice-over, storyboard, video prompts, timeline, caption, and CTA.
5. Click **Generate Video for Scene 1** to create a Wan text-to-video task.
6. Click **Refresh Video Status** until the result is available, then preview the generated clip.

## Architecture Proof Points

- `app/services/showrunner.server.ts` orchestrates the multi-agent pipeline.
- `app/agents/story-agent.server.ts` creates the concept, hook, and voice-over.
- `app/agents/director-agent.server.ts` creates the five-scene short drama structure.
- `app/agents/prompt-agent.server.ts` creates Wan-ready video prompts.
- `app/agents/editor-agent.server.ts` creates the timeline, caption, and CTA.
- `app/services/qwen.server.ts` calls the Qwen Cloud OpenAI-compatible chat API.
- `app/services/wan-video.server.ts` creates and polls Wan text-to-video tasks.
- `docs/architecture.md` contains the high-level system diagram.

## Submission Checklist

- Public repository with `LICENSE`.
- Deployed backend on Alibaba Cloud ECS.
- Short proof recording showing the Alibaba Cloud deployment.
- Public demo video around 3 minutes.
- Devpost description explaining the problem, workflow, Qwen usage, Wan usage, and production-readiness choices.
- Architecture diagram linked from the repo.
- Environment variables documented in `README.md`.
