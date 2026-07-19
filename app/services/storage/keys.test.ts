import { test } from "node:test";
import assert from "node:assert/strict";
import { buildObjectKey, isManagedRef, toRelativeKey } from "~/services/storage/keys";

test("buildObjectKey: product-images has no project segment", () => {
  const key = buildObjectKey("abc-123", { category: "product-images", extension: "jpg" });
  assert.equal(key, "product-images/abc-123.jpg");
});

test("buildObjectKey: normalizes an extension without a leading dot", () => {
  const key = buildObjectKey("abc-123", { category: "product-images", extension: "jpg" });
  const keyWithDot = buildObjectKey("abc-123", { category: "product-images", extension: ".jpg" });
  assert.equal(key, keyWithDot);
});

test("buildObjectKey: scene-videos nests under projectId", () => {
  const key = buildObjectKey("abc-123", {
    category: "scene-videos",
    extension: ".mp4",
    projectId: "proj-1",
  });
  assert.equal(key, "scene-videos/proj-1/abc-123.mp4");
});

test("buildObjectKey: final-videos nests under projectId", () => {
  const key = buildObjectKey("abc-123", {
    category: "final-videos",
    extension: ".mp4",
    projectId: "proj-1",
  });
  assert.equal(key, "final-videos/proj-1/abc-123.mp4");
});

test("isManagedRef: recognizes legacy /uploads/ paths", () => {
  assert.equal(isManagedRef("/uploads/abc.jpg"), true);
});

test("isManagedRef: recognizes canonical category-prefixed keys", () => {
  assert.equal(isManagedRef("product-images/abc.jpg"), true);
  assert.equal(isManagedRef("scene-videos/proj-1/abc.mp4"), true);
  assert.equal(isManagedRef("final-videos/proj-1/abc.mp4"), true);
});

test("isManagedRef: rejects external URLs and empty/undefined refs", () => {
  assert.equal(isManagedRef("https://dashscope.example.com/result/abc.mp4"), false);
  assert.equal(isManagedRef(""), false);
  assert.equal(isManagedRef(undefined), false);
  assert.equal(isManagedRef(null), false);
});

test("isManagedRef: rejects a bare filename with no recognized prefix", () => {
  assert.equal(isManagedRef("abc.jpg"), false);
});

test("toRelativeKey: strips the legacy prefix but leaves canonical keys untouched", () => {
  assert.equal(toRelativeKey("/uploads/abc.jpg"), "abc.jpg");
  assert.equal(toRelativeKey("product-images/abc.jpg"), "product-images/abc.jpg");
});
