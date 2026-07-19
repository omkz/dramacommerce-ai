import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LoaderFunctionArgs } from "react-router";
import { resolveLocalPath } from "~/services/storage/local-storage.server";

// Serves local storage only — this route exists regardless of the active
// MEDIA_STORAGE_DRIVER so legacy "/uploads/..." references keep resolving
// while running in local mode. In OSS mode, new saves resolve to signed OSS
// URLs directly and never route through here.
export async function loader({ params }: LoaderFunctionArgs) {
  const splat = params["*"];

  if (!splat) {
    throw new Response("Invalid filename", { status: 400 });
  }

  let filePath: string;

  try {
    filePath = resolveLocalPath(`/uploads/${splat}`);
  } catch {
    throw new Response("Invalid filename", { status: 400 });
  }

  try {
    const file = await readFile(filePath);

    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": getContentType(splat),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    throw new Response("Image not found", { status: 404 });
  }
}

function getContentType(filename: string): string {
  const extension = path.extname(filename).toLowerCase();

  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".mp4") return "video/mp4";

  return "application/octet-stream";
}
