import Redis from "ioredis";
import { RateLimiterRedis } from "rate-limiter-flexible";

const PER_USER_WINDOW_MINUTES = Number(
  process.env.RATE_LIMIT_GENERATE_PER_USER_WINDOW_MINUTES || "10",
);
const PER_USER_MAX_ATTEMPTS = Number(
  process.env.RATE_LIMIT_GENERATE_PER_USER_MAX || "5",
);
const GLOBAL_DAILY_MAX_ATTEMPTS = Number(
  process.env.RATE_LIMIT_GENERATE_GLOBAL_DAILY_MAX || "200",
);

const GLOBAL_KEY = "global";

const VIDEO_CREATE_WINDOW_MINUTES = Number(
  process.env.RATE_LIMIT_VIDEO_CREATE_WINDOW_MINUTES || "10",
);
const VIDEO_CREATE_MAX_ATTEMPTS = Number(
  process.env.RATE_LIMIT_VIDEO_CREATE_MAX || "10",
);
const VIDEO_STITCH_WINDOW_MINUTES = Number(
  process.env.RATE_LIMIT_VIDEO_STITCH_WINDOW_MINUTES || "10",
);
const VIDEO_STITCH_MAX_ATTEMPTS = Number(
  process.env.RATE_LIMIT_VIDEO_STITCH_MAX || "5",
);

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; message: string };

let redisClient: Redis | null = null;
let perUserLimiter: RateLimiterRedis | null = null;
let globalLimiter: RateLimiterRedis | null = null;
let videoCreateLimiter: RateLimiterRedis | null = null;
let videoStitchLimiter: RateLimiterRedis | null = null;

function getRedisClient(): Redis {
  redisClient ??= new Redis(mustGetRedisUrl(), { maxRetriesPerRequest: null });

  return redisClient;
}

function getLimiters(): {
  perUser: RateLimiterRedis;
  global: RateLimiterRedis;
} {
  if (!perUserLimiter || !globalLimiter) {
    perUserLimiter = new RateLimiterRedis({
      storeClient: getRedisClient(),
      keyPrefix: "rl_generate_user",
      points: PER_USER_MAX_ATTEMPTS,
      duration: PER_USER_WINDOW_MINUTES * 60,
    });

    globalLimiter = new RateLimiterRedis({
      storeClient: getRedisClient(),
      keyPrefix: "rl_generate_global",
      points: GLOBAL_DAILY_MAX_ATTEMPTS,
      duration: 24 * 60 * 60,
    });
  }

  return { perUser: perUserLimiter, global: globalLimiter };
}

function getVideoCreateLimiter(): RateLimiterRedis {
  videoCreateLimiter ??= new RateLimiterRedis({
    storeClient: getRedisClient(),
    keyPrefix: "rl_video_create_user",
    points: VIDEO_CREATE_MAX_ATTEMPTS,
    duration: VIDEO_CREATE_WINDOW_MINUTES * 60,
  });

  return videoCreateLimiter;
}

function getVideoStitchLimiter(): RateLimiterRedis {
  videoStitchLimiter ??= new RateLimiterRedis({
    storeClient: getRedisClient(),
    keyPrefix: "rl_video_stitch_user",
    points: VIDEO_STITCH_MAX_ATTEMPTS,
    duration: VIDEO_STITCH_WINDOW_MINUTES * 60,
  });

  return videoStitchLimiter;
}

function mustGetRedisUrl(): string {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error("REDIS_URL is required.");
  }

  return redisUrl;
}

export async function checkGenerateRateLimit(
  userId: string,
): Promise<RateLimitResult> {
  const { perUser, global } = getLimiters();

  try {
    await perUser.consume(userId);
  } catch {
    return {
      allowed: false,
      message: `Too many generation requests from this account. Try again in a few minutes (limit: ${PER_USER_MAX_ATTEMPTS} per ${PER_USER_WINDOW_MINUTES} minutes).`,
    };
  }

  try {
    await global.consume(GLOBAL_KEY);
  } catch {
    await perUser.reward(userId, 1);

    return {
      allowed: false,
      message: "Daily generation limit reached. Try again tomorrow.",
    };
  }

  return { allowed: true };
}

export async function checkVideoCreateRateLimit(
  userId: string,
  points = 1,
): Promise<RateLimitResult> {
  try {
    await getVideoCreateLimiter().consume(userId, points);

    return { allowed: true };
  } catch {
    return {
      allowed: false,
      message: `Too many video generation requests. Try again in a few minutes (limit: ${VIDEO_CREATE_MAX_ATTEMPTS} per ${VIDEO_CREATE_WINDOW_MINUTES} minutes).`,
    };
  }
}

export async function checkVideoStitchRateLimit(
  userId: string,
): Promise<RateLimitResult> {
  try {
    await getVideoStitchLimiter().consume(userId);

    return { allowed: true };
  } catch {
    return {
      allowed: false,
      message: `Too many final-video requests. Try again in a few minutes (limit: ${VIDEO_STITCH_MAX_ATTEMPTS} per ${VIDEO_STITCH_WINDOW_MINUTES} minutes).`,
    };
  }
}
