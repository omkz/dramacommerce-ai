import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  downloadToFile,
  ExternalRequestError,
  requestJson,
  sanitizeProviderText,
  toLogFields,
} from "~/services/http/http-client.server";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

async function startServer(handler: Handler): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server.");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

async function withTempFile(fn: (destPath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "http-client-test-"));
  const destPath = path.join(dir, "out.bin");

  try {
    await fn(destPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

// --- requestJson ---------------------------------------------------------

test("requestJson: completes before timeout and returns parsed JSON", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  try {
    const { data, status } = await requestJson<{ ok: boolean }>({
      url: server.url,
      timeoutMs: 2000,
      provider: "test",
      operation: "op",
    });

    assert.equal(status, 200);
    assert.equal(data.ok, true);
  } finally {
    await server.close();
  }
});

test("requestJson: aborts and classifies as timeout when the server never responds", async () => {
  const server = await startServer(() => {
    // Never respond.
  });

  try {
    await assert.rejects(
      () => requestJson({ url: server.url, timeoutMs: 100, provider: "test", operation: "op" }),
      (error: unknown) => {
        assert.ok(error instanceof ExternalRequestError);
        assert.equal(error.category, "timeout");
        assert.equal(error.retryable, true);
        return true;
      },
    );
  } finally {
    await server.close();
  }
});

test("requestJson: a delayed response body (headers sent, body never finishes) still times out", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.write("{"); // headers + partial body sent, then hang forever
  });

  try {
    const startedAt = Date.now();

    await assert.rejects(
      () => requestJson({ url: server.url, timeoutMs: 150, provider: "test", operation: "op" }),
      (error: unknown) => {
        assert.ok(error instanceof ExternalRequestError);
        assert.equal(error.category, "timeout");
        return true;
      },
    );

    assert.ok(Date.now() - startedAt < 2000, "should not wait far beyond the configured timeout");
  } finally {
    await server.close();
  }
});

test("requestJson: HTTP 429 is classified retryable (rate_limit)", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(429, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "slow down" }));
  });

  try {
    await assert.rejects(
      () => requestJson({ url: server.url, timeoutMs: 2000, provider: "test", operation: "op" }),
      (error: unknown) => {
        assert.ok(error instanceof ExternalRequestError);
        assert.equal(error.category, "rate_limit");
        assert.equal(error.retryable, true);
        assert.equal(error.status, 429);
        return true;
      },
    );
  } finally {
    await server.close();
  }
});

test("requestJson: HTTP 503 is classified retryable (server_temporary)", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "unavailable" }));
  });

  try {
    await assert.rejects(
      () => requestJson({ url: server.url, timeoutMs: 2000, provider: "test", operation: "op" }),
      (error: unknown) => {
        assert.ok(error instanceof ExternalRequestError);
        assert.equal(error.category, "server_temporary");
        assert.equal(error.retryable, true);
        return true;
      },
    );
  } finally {
    await server.close();
  }
});

test("requestJson: HTTP 401 is classified permanent (auth_config)", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "invalid api key" }));
  });

  try {
    await assert.rejects(
      () => requestJson({ url: server.url, timeoutMs: 2000, provider: "test", operation: "op" }),
      (error: unknown) => {
        assert.ok(error instanceof ExternalRequestError);
        assert.equal(error.category, "auth_config");
        assert.equal(error.retryable, false);
        return true;
      },
    );
  } finally {
    await server.close();
  }
});

test("requestJson: HTTP 403 is classified permanent (auth_config)", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "forbidden" }));
  });

  try {
    await assert.rejects(
      () => requestJson({ url: server.url, timeoutMs: 2000, provider: "test", operation: "op" }),
      (error: unknown) => {
        assert.ok(error instanceof ExternalRequestError);
        assert.equal(error.category, "auth_config");
        assert.equal(error.retryable, false);
        return true;
      },
    );
  } finally {
    await server.close();
  }
});

test("requestJson: a 200 response with a non-JSON body is classified invalid_response (permanent)", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("<html>not json</html>");
  });

  try {
    await assert.rejects(
      () => requestJson({ url: server.url, timeoutMs: 2000, provider: "test", operation: "op" }),
      (error: unknown) => {
        assert.ok(error instanceof ExternalRequestError);
        assert.equal(error.category, "invalid_response");
        assert.equal(error.retryable, false);
        return true;
      },
    );
  } finally {
    await server.close();
  }
});

// --- downloadToFile --------------------------------------------------------

test("downloadToFile: a download under the size limit succeeds and matches the source bytes", async () => {
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

      const written = await readFile(destPath);
      assert.deepEqual(written, body);
    });
  } finally {
    await server.close();
  }
});

test("downloadToFile: a declared Content-Length over the limit is rejected without waiting for the body", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { "content-length": String(10 * 1024 * 1024) });
    res.flushHeaders(); // Node buffers headers until the first write/end otherwise.
    // Never actually sends 10MB — proves the content-length pre-check short-circuits.
  });

  try {
    await withTempFile(async (destPath) => {
      const startedAt = Date.now();

      await assert.rejects(
        () =>
          downloadToFile({
            url: server.url,
            destPath,
            timeoutMs: 5000,
            maxBytes: 1024,
            provider: "test",
            operation: "download",
          }),
        (error: unknown) => {
          assert.ok(error instanceof ExternalRequestError);
          assert.equal(error.category, "oversized_response");
          assert.equal(error.retryable, false);
          return true;
        },
      );

      assert.ok(Date.now() - startedAt < 1000, "content-length pre-check should reject immediately");
      assert.equal(await fileExists(destPath), false);
    });
  } finally {
    await server.close();
  }
});

test("downloadToFile: a chunked response exceeding the limit is stopped mid-stream and the partial file is removed", async () => {
  const chunk = Buffer.alloc(512 * 1024, "a"); // 512KB per chunk, no content-length (chunked transfer)
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
            maxBytes: 1024 * 1024, // 1MB — exceeded partway through the 8x512KB stream
            provider: "test",
            operation: "download",
          }),
        (error: unknown) => {
          assert.ok(error instanceof ExternalRequestError);
          assert.equal(error.category, "oversized_response");
          return true;
        },
      );

      assert.equal(await fileExists(destPath), false, "partial file must be cleaned up");
    });
  } finally {
    await server.close();
  }
});

test("downloadToFile: a non-success HTTP response is rejected", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(500);
    res.end("server error");
  });

  try {
    await withTempFile(async (destPath) => {
      await assert.rejects(
        () =>
          downloadToFile({
            url: server.url,
            destPath,
            timeoutMs: 2000,
            maxBytes: 1024,
            provider: "test",
            operation: "download",
          }),
        (error: unknown) => {
          assert.ok(error instanceof ExternalRequestError);
          assert.equal(error.category, "server_temporary");
          assert.equal(error.retryable, true);
          return true;
        },
      );
    });
  } finally {
    await server.close();
  }
});

test("downloadToFile: exceeding the redirect cap is rejected", async () => {
  // Redirects to itself indefinitely.
  const selfRedirectServer = await startServer((_req, res) => {
    res.writeHead(302, { location: selfRedirectServer.url });
    res.end();
  });

  try {
    await withTempFile(async (destPath) => {
      await assert.rejects(
        () =>
          downloadToFile({
            url: selfRedirectServer.url,
            destPath,
            timeoutMs: 2000,
            maxBytes: 1024,
            provider: "test",
            operation: "download",
            maxRedirects: 2,
          }),
        (error: unknown) => {
          assert.ok(error instanceof ExternalRequestError);
          assert.equal(error.category, "permanent_client");
          assert.match(error.message, /redirects/);
          return true;
        },
      );
    });
  } finally {
    await selfRedirectServer.close();
  }
});

test("downloadToFile: rejects unsupported URL protocols (file:, data:, ftp:)", async () => {
  await withTempFile(async (destPath) => {
    for (const url of ["file:///etc/passwd", "data:text/plain;base64,aGk=", "ftp://example.com/x"]) {
      await assert.rejects(
        () =>
          downloadToFile({
            url,
            destPath,
            timeoutMs: 1000,
            maxBytes: 1024,
            provider: "test",
            operation: "download",
          }),
        (error: unknown) => {
          assert.ok(error instanceof ExternalRequestError);
          assert.equal(error.category, "permanent_client");
          return true;
        },
      );
    }
  });
});

test("downloadToFile: rejects http: in production mode unless allowHttp is explicitly set", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200);
    res.end("ok");
  });

  try {
    await withTempFile(async (destPath) => {
      await assert.rejects(
        () =>
          downloadToFile({
            url: server.url,
            destPath,
            timeoutMs: 1000,
            maxBytes: 1024,
            provider: "test",
            operation: "download",
            allowHttp: false,
          }),
        (error: unknown) => {
          assert.ok(error instanceof ExternalRequestError);
          assert.equal(error.category, "permanent_client");
          assert.match(error.message, /protocol/);
          return true;
        },
      );
    });
  } finally {
    await server.close();
  }
});

test("downloadToFile: rejects an unexpected content-type when expectedContentTypePrefixes is set", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html></html>");
  });

  try {
    await withTempFile(async (destPath) => {
      await assert.rejects(
        () =>
          downloadToFile({
            url: server.url,
            destPath,
            timeoutMs: 2000,
            maxBytes: 1024,
            provider: "test",
            operation: "download",
            expectedContentTypePrefixes: ["video/"],
          }),
        (error: unknown) => {
          assert.ok(error instanceof ExternalRequestError);
          assert.equal(error.category, "invalid_response");
          return true;
        },
      );

      assert.equal(await fileExists(destPath), false);
    });
  } finally {
    await server.close();
  }
});

// --- sanitization ----------------------------------------------------------

test("sanitizeProviderText: redacts bearer tokens", () => {
  const sanitized = sanitizeProviderText("Authorization failed for Bearer sk-abcdef1234567890abcdef");
  assert.ok(!sanitized.includes("sk-abcdef1234567890abcdef"));
  assert.match(sanitized, /Bearer \[redacted\]/);
});

test("sanitizeProviderText: redacts signed-URL query parameters", () => {
  const sanitized = sanitizeProviderText(
    "failed to fetch https://bucket.oss.example.com/key?OSSAccessKeyId=AKID123&Signature=SUPERSECRET&Expires=123",
  );
  assert.ok(!sanitized.includes("SUPERSECRET"));
  assert.ok(!sanitized.includes("AKID123"));
});

test("sanitizeProviderText: truncates to a bounded length", () => {
  const sanitized = sanitizeProviderText("x".repeat(5000));
  assert.ok(sanitized.length <= 300);
});

test("toLogFields: never includes providerMessage or raw response bodies", () => {
  const error = new ExternalRequestError("auth_config", "wan video.create failed with status 401.", {
    provider: "wan",
    operation: "video.create",
    status: 401,
    providerMessage: "Bearer sk-should-not-appear-in-logs",
  });

  const fields = toLogFields(error);
  assert.equal("providerMessage" in fields, false);
  assert.equal(JSON.stringify(fields).includes("sk-should-not-appear-in-logs"), false);
  assert.equal(fields.category, "auth_config");
  assert.equal(fields.provider, "wan");
  assert.equal(fields.status, 401);
});
