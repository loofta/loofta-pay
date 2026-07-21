import { createClient } from "redis";

let client: ReturnType<typeof createClient> | null = null;

async function getRedis() {
  if (!client) {
    client = createClient({ url: process.env.REDIS_URL });
    client.on("error", (err) => console.warn("[redis-cache] client error:", err?.message));
    await client.connect();
  }
  return client;
}

export async function redisGet(key: string): Promise<string | null> {
  try {
    const redis = await getRedis();
    return await redis.get(key);
  } catch {
    return null;
  }
}

export async function redisSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  try {
    const redis = await getRedis();
    await redis.set(key, value, { EX: ttlSeconds });
  } catch {
    /* fail open */
  }
}

export async function redisDel(key: string): Promise<void> {
  try {
    const redis = await getRedis();
    await redis.del(key);
  } catch {
    /* fail open */
  }
}

/**
 * Fixed-window counter: increments `key`, setting it to expire after `ttlSeconds` on first
 * increment. Returns 0 (never exceeds any real limit) on a Redis error, so a Redis hiccup never
 * blocks legitimate requests — same fail-open convention as the rest of this file.
 */
export async function redisIncrWithExpiry(key: string, ttlSeconds: number): Promise<number> {
  try {
    const redis = await getRedis();
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, ttlSeconds);
    }
    return count;
  } catch {
    return 0;
  }
}
