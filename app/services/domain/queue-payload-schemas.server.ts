// Zod schemas for every BullMQ job payload that originates from the
// transactional outbox (see app/services/outbox-dispatch.server.ts) plus the
// showrunner worker's own job.data. Validated at two boundaries: right
// before dispatch (outbox_events.payload is jsonb — Postgres guarantees
// valid JSON, never a guaranteed-correct shape) and again inside the
// worker that consumes it (BullMQ redelivery is at-least-once, and nothing
// stops a stale/mismatched job from being redelivered with an unexpected
// shape). scripts/video-worker.mjs runs via plain `node` and mirrors these
// as scripts/lib/video-job-schemas.mjs — if you change one, change both.
import { z } from "zod";
import { ASPECT_RATIO_OPTIONS } from "~/services/domain/limits.server";

export const showrunnerGenerateJobDataSchema = z.object({
  showrunnerJobId: z.string().min(1, "showrunnerJobId is required."),
  userId: z.string().min(1, "userId is required."),
});

export const videoCreateJobDataSchema = z.object({
  projectId: z.string().min(1, "projectId is required."),
  scene: z.number().int().min(1).max(5),
  prompt: z.string().min(1, "prompt is required."),
  voiceOver: z.string().min(1, "voiceOver is required."),
  productImageUrl: z.string().min(1).optional(),
  useProductReference: z.boolean().optional(),
  showOverlay: z.boolean(),
  aspectRatio: z.enum(ASPECT_RATIO_OPTIONS).optional(),
  generationId: z.string().min(1, "generationId is required."),
});

export const videoStitchJobDataSchema = z.object({
  projectId: z.string().min(1, "projectId is required."),
  stitchGenerationId: z.string().min(1, "stitchGenerationId is required."),
});
