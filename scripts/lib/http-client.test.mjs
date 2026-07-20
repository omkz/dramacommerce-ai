// Mirrors app/services/http/http-client.server.test.ts for the plain-JS
// duplicate used by scripts/video-worker.mjs — not exhaustive (the TS suite
// already covers every code path in detail), just enough to catch the two
// implementations drifting apart.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { downloadToFile, ExternalRequestError, requestJson, sanitizeProviderText } from "./http-client.mjs";

async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

async function withTempFile(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "http-client-mjs-test-"));
  const destPath = path.join(dir, "out.bin");

  try {
    await fn(destPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

test("mjs requestJson: completes before timeout", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  try {
    const { data } = await requestJson({ url: server.url, timeoutMs: 2000, provider: "test", operation: "op" });
    assert.equal(data.ok, true);
  } finally {
    await server.close();
  }
});

test("mjs requestJson: times out against a server that never responds", async () => {
  const server = await startServer(() => {});

  try {
    await assert.rejects(
      () => requestJson({ url: server.url, timeoutMs: 100, provider: "test", operation: "op" }),
      (error) => {
        assert.ok(error instanceof ExternalRequestError);
        assert.equal(error.category, "timeout");
        return true;
      },
    );
  } finally {
    await server.close();
  }
});

test("mjs requestJson: 429 is retryable, 401 is not", async () => {
  const rateLimited = await startServer((_req, res) => {
    res.writeHead(429, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "slow down" }));
  });
  const unauthorized = await startServer((_req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "bad key" }));
  });

  try {
    await assert.rejects(
      () => requestJson({ url: rateLimited.url, timeoutMs: 2000, provider: "test", operation: "op" }),
      (error) => {
        assert.equal(error.category, "rate_limit");
        assert.equal(error.retryable, true);
        return true;
      },
    );

    await assert.rejects(
      () => requestJson({ url: unauthorized.url, timeoutMs: 2000, provider: "test", operation: "op" }),
      (error) => {
        assert.equal(error.category, "auth_config");
        assert.equal(error.retryable, false);
        return true;
      },
    );
  } finally {
    await rateLimited.close();
    await unauthorized.close();
  }
});

test("mjs downloadToFile: chunked response exceeding the limit is stopped and the partial file removed", async () => {
  const chunk = Buffer.alloc(512 * 1024, "a");
  const server = await startServer((_req, res) => {
    res.writeHead(200, { "content-type": "video/mp4" });
    let sent = 0;
    const interval = setInterval(() => {
      if (sent >= 8) {
        clearInterval(interval);
        res.end();
        return;
      }
      res.write(chunk);
      sent += 1;
    }, 5);
    res.on("close", () => clearInterval(interval));
  });

  try {
    await withTempFile(async (destPath) => {
      await assert.rejects(
        () =>
          downloadToFile({
            url: server.url,
            destPath,
            timeoutMs: 5000,
            maxBytes: 1024 * 1024,
            provider: "test",
            operation: "download",
          }),
        (error) => {
          assert.equal(error.category, "oversized_response");
          return true;
        },
      );

      assert.equal(await fileExists(destPath), false);
    });
  } finally {
    await server.close();
  }
});

test("mjs downloadToFile: a download under the size limit succeeds", async () => {
  const body = Buffer.from("hello world");
  const server = await startServer((_req, res) => {
    res.writeHead(200, { "content-type": "video/mp4" });
    res.end(body);
  });

  try {
    await withTempFile(async (destPath) => {
      await downloadToFile({
        url: server.url,
        destPath,
        timeoutMs: 2000,
        maxBytes: 1024,
        provider: "test",
        operation: "download",
      });

      assert.deepEqual(await readFile(destPath), body);
    });
  } finally {
    await server.close();
  }
});

test("mjs downloadToFile: rejects unsupported URL protocols", async () => {
  await withTempFile(async (destPath) => {
    await assert.rejects(
      () =>
        downloadToFile({
          url: "file:///etc/passwd",
          destPath,
          timeoutMs: 1000,
          maxBytes: 1024,
          provider: "test",
          operation: "download",
        }),
      (error) => {
        assert.equal(error.category, "permanent_client");
        return true;
      },
    );
  });
});

test("mjs sanitizeProviderText: redacts bearer tokens and signed URL params", () => {
  const sanitized = sanitizeProviderText(
    "Bearer sk-abcdef1234567890 leaked in https://x.example.com/o?Signature=SECRET123",
  );
  assert.ok(!sanitized.includes("sk-abcdef1234567890"));
  assert.ok(!sanitized.includes("SECRET123"));
});
