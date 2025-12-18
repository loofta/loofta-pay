/**
 * Redis Distributed Lock
 * 
 * Prevents concurrent processing of the same payment/claim
 * Uses Redis SET with NX (only if not exists) and EX (expiry)
 */

import { createClient } from "redis";

let redisClient: ReturnType<typeof createClient> | null = null;

async function getRedis() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL });
    await redisClient.connect();
  }
  return redisClient;
}

/**
 * Acquire a distributed lock
 * @param key - Lock key (e.g., "lock:payment:0x123...")
 * @param ttlSeconds - Lock expiry in seconds (default 300 = 5 minutes)
 * @returns true if lock acquired, false if already locked
 */
export async function acquireLock(key: string, ttlSeconds: number = 300): Promise<boolean> {
  const redis = await getRedis();
  const lockKey = `lock:${key}`;
  
  try {
    // SET key value NX EX ttl - only set if not exists, with expiry
    const result = await redis.set(lockKey, "1", {
      NX: true, // Only set if not exists
      EX: ttlSeconds, // Expire after ttlSeconds
    });
    
    return result === "OK";
  } catch (error) {
    console.error(`[Redis Lock] Error acquiring lock ${key}:`, error);
    return false;
  }
}

/**
 * Release a distributed lock
 * @param key - Lock key
 */
export async function releaseLock(key: string): Promise<void> {
  const redis = await getRedis();
  const lockKey = `lock:${key}`;
  
  try {
    await redis.del(lockKey);
  } catch (error) {
    console.error(`[Redis Lock] Error releasing lock ${key}:`, error);
  }
}

/**
 * Execute a function with a distributed lock
 * Automatically releases lock after execution (success or failure)
 */
export async function withLock<T>(
  key: string,
  fn: () => Promise<T>,
  ttlSeconds: number = 300
): Promise<T | null> {
  const acquired = await acquireLock(key, ttlSeconds);
  
  if (!acquired) {
    console.log(`[Redis Lock] Could not acquire lock for ${key}, skipping`);
    return null;
  }
  
  try {
    return await fn();
  } finally {
    await releaseLock(key);
  }
}

