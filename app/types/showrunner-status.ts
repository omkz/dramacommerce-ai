export const SHOWRUNNER_JOB_STATUSES = [
  "QUEUED",
  "ANALYZING",
  "STORY",
  "DIRECTING",
  "PROMPTING",
  "CRITIQUING",
  "EDITING",
  "SUCCEEDED",
  "FAILED",
] as const;

export type ShowrunnerJobStatus = (typeof SHOWRUNNER_JOB_STATUSES)[number];

export function isShowrunnerJobStatus(
  status: string | null | undefined,
): status is ShowrunnerJobStatus {
  return SHOWRUNNER_JOB_STATUSES.includes(status as ShowrunnerJobStatus);
}

export function parseShowrunnerJobStatus(
  status: string | null | undefined,
): ShowrunnerJobStatus {
  return isShowrunnerJobStatus(status) ? status : "FAILED";
}
