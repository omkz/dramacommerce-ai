// Every string bound, enum option, and duration constant used across the
// showrunner pipeline (AI output validation, merchant-edit validation,
// persisted-JSON validation) lives here — the single source `schemas.server.ts`
// builds Zod schemas from, and the single source routes read enum options
// from. Zero imports from other server services, so nothing here can create
// an import cycle with the modules that depend on it.

export const MOOD_OPTIONS = [
  "Cinematic",
  "Funny",
  "Premium",
  "Emotional",
  "Fast-paced",
] as const;

export const PLATFORM_OPTIONS = [
  "TikTok",
  "Instagram Reels",
  "YouTube Shorts",
] as const;

export const ASPECT_RATIO_OPTIONS = ["9:16", "1:1", "16:9"] as const;

export const PRODUCT_REFERENCE_MODE_OPTIONS = ["auto", "force", "disable"] as const;

export const DRAMATIC_BEAT_OPTIONS = [
  "setup",
  "tension",
  "turning_point",
  "climax",
  "resolution",
] as const;

// The only four options the brief form has ever offered — every persisted
// brief.duration value (current or legacy) is one of these strings, so this
// doubles as both the enum and the canonical seconds lookup, replacing the
// bare string Set that used to live only in routes/projects.new.tsx.
export const PRODUCT_DURATION_SECONDS = {
  "15 seconds": 15,
  "30 seconds": 30,
  "45 seconds": 45,
  "60 seconds": 60,
} as const;

export const DURATION_OPTIONS = Object.keys(
  PRODUCT_DURATION_SECONDS,
) as (keyof typeof PRODUCT_DURATION_SECONDS)[];

export function getProductDurationSeconds(duration: string): number | undefined {
  return (PRODUCT_DURATION_SECONDS as Record<string, number | undefined>)[duration];
}

// String length bounds. Every required field also rejects whitespace-only
// input (trimmed before the min check). These are deliberately generous
// enough to never truncate genuine creative content — a value that exceeds
// its max is a validation failure (see the AI repair path), never silently
// cut.
export const LIMITS = {
  productName: { min: 1, max: 120 },
  productDescription: { min: 0, max: 500 },
  keySellingPoints: { min: 0, max: 500 },
  offer: { min: 0, max: 180 },
  targetAudience: { min: 1, max: 200 },
  imageName: { min: 1, max: 255 },
  concept: { min: 1, max: 600 },
  conflict: { min: 1, max: 400 },
  hook: { min: 1, max: 200 },
  overallVoiceOver: { min: 1, max: 2000 },
  sceneTitle: { min: 1, max: 80 },
  sceneVisual: { min: 1, max: 500 },
  sceneCamera: { min: 1, max: 120 },
  sceneEmotion: { min: 1, max: 60 },
  sceneDuration: { min: 1, max: 20 },
  // A hard structural ceiling on scene voice-over independent of duration —
  // guards against a wildly pathological response reaching persistence at
  // all. The real, duration-aware bound merchants and agents are actually
  // held to is getMaxSceneVoiceOverChars() below, which is always much
  // smaller than this ceiling in practice.
  sceneVoiceOverCeiling: { min: 1, max: 600 },
  videoPrompt: { min: 1, max: 1200 },
  caption: { min: 1, max: 2200 },
  cta: { min: 1, max: 150 },
  criticNotes: { min: 0, max: 1000 },
  analysisField: { min: 1, max: 200 },
  analysisColor: { min: 1, max: 40 },
  analysisIssue: { min: 1, max: 200 },
  timelineEntry: { min: 1, max: 300 },
} as const;

export const ARRAY_LIMITS = {
  analysisColors: { max: 12 },
  analysisIssues: { max: 20 },
  timelineEntries: { max: 40 },
} as const;

// Narrative scene-duration label shape, e.g. "0-4s" — cosmetic/prompt text
// only (confirmed: never parsed or computed with anywhere in the app, just
// displayed and fed into agent prompts), so this stays a validated string
// format rather than a numeric range. Optional whitespace around the dash
// tolerates trivial LLM formatting drift.
export const SCENE_DURATION_PATTERN = /^\d{1,3}\s*-\s*\d{1,3}\s*s$/;

// The one number that actually determines render length: Wan renders every
// scene at this same fixed duration regardless of the scene's narrative
// pacing (see getMaxSceneVoiceOverChars below). Validated the same way
// app/services/http/timeout-config.server.ts validates its env vars — unset
// falls back to the pre-existing default of 5, but a present, invalid value
// (non-numeric, zero, negative, or an unreasonably large render length)
// throws rather than silently misbehaving.
const MAX_WAN_SCENE_DURATION_SECONDS = 120;

export function getWanSceneDurationSeconds(): number {
  const raw = process.env.WAN_VIDEO_DURATION;

  if (raw === undefined || raw.trim() === "") {
    return 5;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid WAN_VIDEO_DURATION="${raw}": must be a positive integer (seconds).`);
  }

  if (parsed > MAX_WAN_SCENE_DURATION_SECONDS) {
    throw new Error(
      `Invalid WAN_VIDEO_DURATION="${raw}": exceeds the maximum allowed value of ${MAX_WAN_SCENE_DURATION_SECONDS}.`,
    );
  }

  return parsed;
}

// Wan renders every scene at a fixed WAN_VIDEO_DURATION regardless of the
// scene's narrative pacing, so a voice-over line longer than that gets cut
// off mid-sentence when muxed (ffmpeg's -shortest caps the output at the
// video's length). 15 chars/sec is a conservative *approximate* average
// spoken-pace estimate — real speech rate varies by language and voice, so
// this is deliberately named for what it actually is (an approximation) and
// kept conservative rather than tightened further without real
// TTS-duration measurement. This is the single shared rule: both the
// merchant-edit route and the AI-output validator call
// getMaxSceneVoiceOverChars() rather than each hardcoding their own number.
export const APPROXIMATE_SPOKEN_CHARS_PER_SECOND = 15;
const MIN_SCENE_VOICE_OVER_CHARS = 20;

export function getMaxSceneVoiceOverChars(): number {
  return Math.max(
    MIN_SCENE_VOICE_OVER_CHARS,
    Math.round(getWanSceneDurationSeconds() * APPROXIMATE_SPOKEN_CHARS_PER_SECOND),
  );
}

export const CURRENT_SHOW_PLAN_SCHEMA_VERSION = 1;
