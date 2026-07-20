// Races an async check against a bound so a hung dependency (Postgres,
// Redis, OSS, ...) can't make the caller (currently only /health) hang
// indefinitely. Cannot forcibly cancel the underlying call — most of the
// drivers this wraps (pg, ioredis, ali-oss) don't expose a clean mid-flight
// cancel — it only stops *waiting* on it; the abandoned call is left to
// resolve/reject on its own in the background.
export async function withTimeout<T>(
  check: () => Promise<T>,
  timeoutMs: number,
  onTimeout: () => T,
): Promise<T> {
  let timer: NodeJS.Timeout;

  const timedOut = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), timeoutMs);
  });

  try {
    return await Promise.race([check(), timedOut]);
  } finally {
    clearTimeout(timer!);
  }
}
