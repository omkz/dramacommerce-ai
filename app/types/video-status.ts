export const VIDEO_GENERATION_STATUSES = [
  "QUEUED",
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
  "UNKNOWN",
] as const;

export type VideoGenerationStatus = (typeof VIDEO_GENERATION_STATUSES)[number];

export function isVideoGenerationStatus(
  status: string | null | undefined,
): status is VideoGenerationStatus {
  return VIDEO_GENERATION_STATUSES.includes(status as VideoGenerationStatus);
}

export function parseVideoGenerationStatus(
  status: string | null | undefined,
): VideoGenerationStatus {
  return isVideoGenerationStatus(status) ? status : "UNKNOWN";
}
