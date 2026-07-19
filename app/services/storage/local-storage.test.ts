import { test } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { createLocalStorageDriver } from "~/services/storage/local-storage.server";

const driver = createLocalStorageDriver();
// Isolated under its own project id so this test never collides with real
// uploads/ data; removed in the top-level cleanup below regardless of which
// assertion (if any) fails first.
const TEST_PROJECT_ID = `test-${Date.now()}`;

test("local storage: save/read/delete round-trip for a product image", async () => {
  const buffer = Buffer.from("fake-jpeg-bytes");
  const key = await driver.saveBuffer(buffer, { category: "product-images", extension: "jpg" });

  assert.match(key, /^product-images\/[0-9a-f-]+\.jpg$/);

  const readBack = await driver.readBuffer(key);
  assert.deepEqual(readBack, buffer);

  await driver.delete(key);
  await assert.rejects(() => driver.readBuffer(key));
});

test("local storage: saveFromPath nests scene-videos under projectId", async () => {
  const os = await import("node:os");
  const { writeFile } = await import("node:fs/promises");
  const sourcePath = path.join(os.tmpdir(), `local-storage-test-${Date.now()}.mp4`);
  await writeFile(sourcePath, Buffer.from("fake-mp4-bytes"));

  try {
    const key = await driver.saveFromPath(sourcePath, {
      category: "scene-videos",
      extension: ".mp4",
      projectId: TEST_PROJECT_ID,
    });

    assert.match(key, new RegExp(`^scene-videos/${TEST_PROJECT_ID}/[0-9a-f-]+\\.mp4$`));

    const readBack = await driver.readBuffer(key);
    assert.deepEqual(readBack, Buffer.from("fake-mp4-bytes"));

    await driver.delete(key);
  } finally {
    await rm(sourcePath, { force: true });
  }
});

test("local storage: readAsDataUrl detects content-based mime type", async () => {
  // A real (if trivial) 1x1 transparent PNG — file-type needs a fully valid
  // file, not just the magic-number prefix, to positively detect PNG.
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const key = await driver.saveBuffer(onePixelPng, { category: "product-images", extension: "jpg" });

  try {
    const dataUrl = await driver.readAsDataUrl(key);
    assert.match(dataUrl, /^data:image\/png;base64,/);
  } finally {
    await driver.delete(key);
  }
});

test("local storage: rejects path traversal in a manufactured ref", async () => {
  await assert.rejects(() => driver.readBuffer("product-images/../../../etc/passwd"));
  await assert.rejects(() => driver.readBuffer("/uploads/../../etc/passwd"));
});

test("local storage: rejects reading a ref with no recognized prefix", async () => {
  await assert.rejects(() => driver.readBuffer("not-a-managed-ref.jpg"));
});

test("local storage: delete is a no-op for an unmanaged ref (matches prior deleteUploadedFile behavior)", async () => {
  await assert.doesNotReject(() => driver.delete("https://example.com/not-ours.jpg"));
});

test("local storage: resolveUrl maps legacy and canonical refs to /uploads/*", async () => {
  assert.equal(await driver.resolveUrl("/uploads/abc.jpg"), "/uploads/abc.jpg");
  assert.equal(
    await driver.resolveUrl("product-images/abc.jpg"),
    "/uploads/product-images/abc.jpg",
  );
});

test("local storage: healthCheck reports ok for a writable uploads/ dir", async () => {
  const result = await driver.healthCheck();
  assert.equal(result.status, "ok");
});

test.after(async () => {
  await rm(path.join(process.cwd(), "uploads", "scene-videos", TEST_PROJECT_ID), {
    recursive: true,
    force: true,
  });
});
