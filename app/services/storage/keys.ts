// Object keys double as both the OSS object key and the local relative path
// under uploads/ — one string format, interpreted identically by both
// drivers. This is what gets persisted to Postgres (brief.imageUrl,
// video_jobs.video_url, final_videos.video_url), never a resolved URL.
export type MediaCategory = "product-images" | "scene-videos" | "final-videos";

const CATEGORY_PREFIXES: MediaCategory[] = [
  "product-images",
  "scene-videos",
  "final-videos",
];

// Pre-storage-abstraction rows persisted a literal "/uploads/<filename>"
// browser path as the "URL" field. Those still resolve correctly under
// MEDIA_STORAGE_DRIVER=local (same uploads/ directory, flat layout) — this
// prefix is how both drivers recognize and special-case that legacy shape.
// It is never produced by new writes.
export const LEGACY_UPLOADS_PREFIX = "/uploads/";

export type SaveKeyOptions =
  | { category: "product-images"; extension: string }
  | { category: "scene-videos" | "final-videos"; extension: string; projectId: string };

export function buildObjectKey(uuid: string, options: SaveKeyOptions): string {
  const extension = options.extension.startsWith(".")
    ? options.extension
    : `.${options.extension}`;

  if (options.category === "product-images") {
    return `${options.category}/${uuid}${extension}`;
  }

  return `${options.category}/${options.projectId}/${uuid}${extension}`;
}

// True for anything our storage drivers own: a legacy "/uploads/..." path or
// a bare category-prefixed key. False for arbitrary external URLs (e.g. raw
// Wan/TTS provider URLs mid-flight, before we've copied them into our own
// storage) — those must go through a real network fetch, not a storage read.
export function isManagedRef(ref: string | null | undefined): ref is string {
  if (!ref) {
    return false;
  }

  if (ref.startsWith(LEGACY_UPLOADS_PREFIX)) {
    return true;
  }

  return CATEGORY_PREFIXES.some((category) => ref.startsWith(`${category}/`));
}

// Strips the legacy "/uploads/" prefix if present, otherwise returns the ref
// unchanged (it's already a bare canonical key). Both shapes resolve to the
// same relative-path semantics for local storage, and the same object-key
// semantics for OSS.
export function toRelativeKey(ref: string): string {
  return ref.startsWith(LEGACY_UPLOADS_PREFIX)
    ? ref.slice(LEGACY_UPLOADS_PREFIX.length)
    : ref;
}
