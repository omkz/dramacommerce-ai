// Plain-JS mirror of the single shared voice-over-duration rule from
// app/services/domain/limits.server.ts, for video-worker.mjs (runs via
// plain `node`, cannot import TS modules — see CLAUDE.md's note on that
// worker's duplication pattern). Only the one rule this worker needs; the
// rest of limits.server.ts (string bounds, enum options) has no JS-side
// consumer. If you change the formula in one, change both.

const MAX_WAN_SCENE_DURATION_SECONDS = 120;

export function getWanSceneDurationSeconds() {
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
// spoken-pace estimate — same rule, same constant, as the merchant-edit
// route and the AI-output validator (app/services/domain/limits.server.ts).
export const APPROXIMATE_SPOKEN_CHARS_PER_SECOND = 15;
const MIN_SCENE_VOICE_OVER_CHARS = 20;

export function getMaxSceneVoiceOverChars() {
  return Math.max(
    MIN_SCENE_VOICE_OVER_CHARS,
    Math.round(getWanSceneDurationSeconds() * APPROXIMATE_SPOKEN_CHARS_PER_SECOND),
  );
}
