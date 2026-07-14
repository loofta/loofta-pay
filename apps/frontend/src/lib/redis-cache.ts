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
