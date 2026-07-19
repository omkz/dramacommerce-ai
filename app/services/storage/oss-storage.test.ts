import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createOssStorageDriver, type OssClientLike } from "~/services/storage/oss-storage.server";

const OSS_ENV_KEYS = [
  "OSS_REGION",
  "OSS_BUCKET",
  "OSS_ACCESS_KEY_ID",
  "OSS_ACCESS_KEY_SECRET",
  "OSS_PUBLIC_BASE_URL",
  "OSS_SIGNED_URL_EXPIRES_SECONDS",
];
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of OSS_ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function makeFakeClient(overrides: Partial<OssClientLike> = {}): OssClientLike {
  return {
    put: async (name) => ({ name, url: `https://fake-bucket.example.com/${name}` }),
    get: async () => ({ content: Buffer.from("fake-content") }),
    delete: async () => ({}),
    signatureUrl: (name) => `https://fake-bucket.example.com/${name}?signature=fake`,
    list: async () => ({ objects: [] }),
    ...overrides,
  };
}

test("oss storage: saveBuffer writes to a canonical key via client.put", async () => {
  const calls: Array<{ key: string; file: unknown }> = [];
  const client = makeFakeClient({
    put: async (name, file) => {
      calls.push({ key: name, file });
      return { name, url: "https://fake/x" };
    },
  });
  const driver = createOssStorageDriver({ client });

  const key = await driver.saveBuffer(Buffer.from("hi"), {
    category: "product-images",
    extension: "jpg",
  });

  assert.match(key, /^product-images\/[0-9a-f-]+\.jpg$/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, key);
});

test("oss storage: saveFromPath passes the local path straight through to client.put", async () => {
  let receivedFile: unknown;
  const client = makeFakeClient({
    put: async (name, file) => {
      receivedFile = file;
      return { name, url: "https://fake/x" };
    },
  });
  const driver = createOssStorageDriver({ client });

  await driver.saveFromPath("/tmp/some-local-file.mp4", {
    category: "final-videos",
    extension: ".mp4",
    projectId: "proj-1",
  });

  assert.equal(receivedFile, "/tmp/some-local-file.mp4");
});

test("oss storage: readBuffer returns the client's content buffer", async () => {
  const client = makeFakeClient({
    get: async () => ({ content: Buffer.from("hello") }),
  });
  const driver = createOssStorageDriver({ client });

  const buffer = await driver.readBuffer("product-images/abc.jpg");
  assert.deepEqual(buffer, Buffer.from("hello"));
});

test("oss storage: readBuffer rejects an unmanaged ref without calling the client", async () => {
  let called = false;
  const client = makeFakeClient({
    get: async () => {
      called = true;
      return { content: Buffer.alloc(0) };
    },
  });
  const driver = createOssStorageDriver({ client });

  await assert.rejects(() => driver.readBuffer("https://example.com/not-ours.jpg"));
  assert.equal(called, false);
});

test("oss storage: delete swallows client errors instead of throwing (matches deleteUploadedFile's fire-and-forget contract)", async () => {
  const client = makeFakeClient({
    delete: async () => {
      throw new Error("network blip");
    },
  });
  const driver = createOssStorageDriver({ client });

  await assert.doesNotReject(() => driver.delete("product-images/abc.jpg"));
});

test("oss storage: resolveUrl signs a URL by default (no OSS_PUBLIC_BASE_URL)", async () => {
  const driver = createOssStorageDriver({ client: makeFakeClient() });

  const url = await driver.resolveUrl("product-images/abc.jpg");
  assert.match(url, /^https:\/\/fake-bucket\.example\.com\/product-images\/abc\.jpg\?signature=fake$/);
});

test("oss storage: resolveUrl uses OSS_PUBLIC_BASE_URL when configured", async () => {
  process.env.OSS_PUBLIC_BASE_URL = "https://cdn.example.com/media/";
  const driver = createOssStorageDriver({ client: makeFakeClient() });

  const url = await driver.resolveUrl("product-images/abc.jpg");
  assert.equal(url, "https://cdn.example.com/media/product-images/abc.jpg");
});

test("oss storage: healthCheck reports missing required env vars without a client call", async () => {
  let called = false;
  const client = makeFakeClient({
    list: async () => {
      called = true;
      return { objects: [] };
    },
  });
  const driver = createOssStorageDriver({ client });

  const result = await driver.healthCheck();
  assert.equal(result.status, "error");
  assert.match(result.message ?? "", /OSS_REGION/);
  assert.equal(called, false);
});

test("oss storage: healthCheck reports ok when env vars are set and the client responds", async () => {
  process.env.OSS_REGION = "oss-cn-hangzhou";
  process.env.OSS_BUCKET = "test-bucket";
  process.env.OSS_ACCESS_KEY_ID = "fake-id";
  process.env.OSS_ACCESS_KEY_SECRET = "fake-secret-value";

  const driver = createOssStorageDriver({ client: makeFakeClient() });

  const result = await driver.healthCheck();
  assert.equal(result.status, "ok");
});

test("oss storage: error messages never leak the access key secret", async () => {
  process.env.OSS_REGION = "oss-cn-hangzhou";
  process.env.OSS_BUCKET = "test-bucket";
  process.env.OSS_ACCESS_KEY_ID = "fake-id";
  const secret = "SUPER-SECRET-DO-NOT-LEAK";
  process.env.OSS_ACCESS_KEY_SECRET = secret;

  const client = makeFakeClient({
    put: async () => {
      const error = new Error("Access Denied") as Error & Record<string, unknown>;
      error.name = "AccessDeniedError";
      error.code = "AccessDenied";
      error.status = 403;
      // Simulates an SDK error shape that carries request config/headers —
      // describeOssError must not surface this even if present.
      error.config = { headers: { Authorization: `Bearer ${secret}` } };
      throw error;
    },
  });
  const driver = createOssStorageDriver({ client });

  await assert.rejects(
    () => driver.saveBuffer(Buffer.from("x"), { category: "product-images", extension: "jpg" }),
    (error: Error) => {
      assert.equal(error.message.includes(secret), false);
      assert.match(error.message, /AccessDenied/);
      return true;
    },
  );
});
