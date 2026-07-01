import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LoaderFunctionArgs } from "react-router";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

export async function loader({ params }: LoaderFunctionArgs) {
  const filename = params.filename;

  if (!filename || filename.includes("/") || filename.includes("..")) {
    throw new Response("Invalid filename", { status: 400 });
  }

  const filePath = path.join(UPLOAD_DIR, filename);

  try {
    const file = await readFile(filePath);

    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": getContentType(filename),
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
  if (extension === ".gif") return "image/gif";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";

  return "application/octet-stream";
}
