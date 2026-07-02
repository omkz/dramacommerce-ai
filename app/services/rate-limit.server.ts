import Redis from "ioredis";
import { RateLimiterRedis } from "rate-limiter-flexible";

const PER_IP_WINDOW_MINUTES = Number(
  process.env.RATE_LIMIT_GENERATE_PER_IP_WINDOW_MINUTES || "10",
);
const PER_IP_MAX_ATTEMPTS = Number(
  process.env.RATE_LIMIT_GENERATE_PER_IP_MAX || "5",
);
const GLOBAL_DAILY_MAX_ATTEMPTS = Number(
  process.env.RATE_LIMIT_GENERATE_GLOBAL_DAILY_MAX || "200",
);

const GLOBAL_KEY = "global";

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; message: string };

let redisClient: Redis | null = null;
let perIpLimiter: RateLimiterRedis | null = null;
let globalLimiter: RateLimiterRedis | null = null;

function getLimiters(): {
  perIp: RateLimiterRedis;
  global: RateLimiterRedis;
} {
  if (!perIpLimiter || !globalLimiter) {
    redisClient ??= new Redis(mustGetRedisUrl(), { maxRetriesPerRequest: null });

    perIpLimiter = new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: "rl_generate_ip",
      points: PER_IP_MAX_ATTEMPTS,
      duration: PER_IP_WINDOW_MINUTES * 60,
    });

    globalLimiter = new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: "rl_generate_global",
      points: GLOBAL_DAILY_MAX_ATTEMPTS,
      duration: 24 * 60 * 60,
    });
  }

  return { perIp: perIpLimiter, global: globalLimiter };
}

function mustGetRedisUrl(): string {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error("REDIS_URL is required.");
  }

  return redisUrl;
}

export async function checkGenerateRateLimit(
  ip: string,
): Promise<RateLimitResult> {
  const { perIp, global } = getLimiters();

  try {
    await perIp.consume(ip);
  } catch {
    return {
      allowed: false,
      message: `Too many generation requests from this network. Try again in a few minutes (limit: ${PER_IP_MAX_ATTEMPTS} per ${PER_IP_WINDOW_MINUTES} minutes).`,
    };
  }

  try {
    await global.consume(GLOBAL_KEY);
  } catch {
    await perIp.reward(ip, 1);

    return {
      allowed: false,
      message: "Daily generation limit reached. Try again tomorrow.",
    };
  }

  return { allowed: true };
}

export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]!.trim();
  }

  const realIp = request.headers.get("x-real-ip");

  if (realIp) {
    return realIp.trim();
  }

  return "unknown";
}
