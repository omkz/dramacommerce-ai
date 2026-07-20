// Normalized domain/validation error types so routes and workers can branch
// on *why* something failed instead of pattern-matching message strings.
// Complements app/services/http/http-client.server.ts's ExternalRequestError
// (network/provider failures) — this module is specifically for failures
// that happen without ever leaving the process: bad merchant input, AI
// output that doesn't fit the schema, corrupted persisted JSON, an
// unsupported/future schema version, or a malformed queue payload.
import { z } from "zod";

export type DomainErrorCategory =
  | "merchant_input"
  | "invalid_ai_output"
  | "invalid_persisted_data"
  | "unsupported_legacy_schema"
  | "invalid_worker_payload"
  | "render_readiness";

export class DomainValidationError extends Error {
  readonly category: DomainErrorCategory;
  // Sanitized, bounded issue summaries — "path: code" only, never the raw
  // field value (which may be full AI-generated prose or merchant-submitted
  // product data that shouldn't land in a log line or a DB errorMessage
  // column).
  readonly issueSummaries: string[];

  constructor(category: DomainErrorCategory, message: string, issueSummaries: string[] = []) {
    super(message);
    this.name = "DomainValidationError";
    this.category = category;
    this.issueSummaries = issueSummaries;
  }
}

const MAX_ISSUES_SUMMARIZED = 8;
const MAX_MESSAGE_LENGTH = 500;

export function summarizeZodIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, MAX_ISSUES_SUMMARIZED).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.code}`;
  });
}

export function buildDomainValidationError(
  category: DomainErrorCategory,
  contextLabel: string,
  error: z.ZodError,
): DomainValidationError {
  const summaries = summarizeZodIssues(error);
  const message = `${contextLabel}: ${summaries.join("; ")}`.slice(0, MAX_MESSAGE_LENGTH);

  return new DomainValidationError(category, message, summaries);
}

// Safe, bounded fields for structured logging — mirrors
// app/services/http/http-client.server.ts#toLogFields so both error
// families produce the same shape of log line.
export function toLogFields(error: unknown): Record<string, unknown> {
  if (error instanceof DomainValidationError) {
    return { category: error.category, issues: error.issueSummaries };
  }

  return { message: error instanceof Error ? error.message : String(error) };
}
