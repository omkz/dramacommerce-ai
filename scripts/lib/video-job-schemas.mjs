// Plain-JS mirror of app/services/domain/queue-payload-schemas.server.ts for
// video-worker.mjs (runs via plain `node`, cannot import TS modules — see
// CLAUDE.md's note on that worker's duplication pattern). zod is a real npm
// dependency, so unlike the http-client/media-storage mirrors this one can
// literally reuse the same schema-building calls, just written in plain JS.
// Covers video.create/video.poll (which never goes through the outbox — see
// CLAUDE.md's Reliability section — so this is its only payload validation)
// /video.stitch job.data as actually destructured in this file. If you
// change one, change both.
import { z } from "zod";

const ASPECT_RATIO_OPTIONS = ["9:16", "1:1", "16:9"];

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

export const videoPollJobDataSchema = z.object({
  projectId: z.string().min(1, "projectId is required."),
  scene: z.number().int().min(1).max(5),
  taskId: z.string().min(1, "taskId is required."),
  voiceOver: z.string().min(1, "voiceOver is required."),
  productImageUrl: z.string().min(1).optional(),
  useProductReference: z.boolean().optional(),
  showOverlay: z.boolean().optional(),
  generationId: z.string().min(1, "generationId is required."),
});

export const videoStitchJobDataSchema = z.object({
  projectId: z.string().min(1, "projectId is required."),
  stitchGenerationId: z.string().min(1, "stitchGenerationId is required."),
});
