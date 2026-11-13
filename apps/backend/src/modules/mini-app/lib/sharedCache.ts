/* eslint-disable */
// A small cache the mini app handlers share. Redis is the main store, so answers survive a restart and are shared by every
// backend instance. If REDIS_URL is not set or Redis is down it quietly falls back to memory, so nothing breaks.
// Identical requests that arrive together are merged into one upstream call.
import type Redis from "ioredis";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let redis: Redis | null = null;
/** Called once by RedisService when its connection is created. */
export function bindRedis(client: Redis | null) {
  redis = client;
}

const mem = new Map<string, { exp: number; value: string }>();
const inflight = new Map<string, Promise<unknown>>();
const MAX_MEM = 2_000;

async function read(key: string): Promise<string | null> {
  if (redis && redis.status === "ready") {
    try {
      const v = await redis.get(key);
      if (v != null) return v;
    } catch {
      /* fall through to memory */
    }
  }
  const hit = mem.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  return null;
}

async function write(key: string, value: string, ttlSec: number) {
  if (mem.size > MAX_MEM) mem.clear();
  mem.set(key, { exp: Date.now() + ttlSec * 1000, value });
  if (redis && redis.status === "ready") {
    try {
      await redis.set(key, value, "EX", ttlSec);
    } catch {
      /* memory copy is already saved */
    }
  }
}

/**
 * Returns the cached answer for key, or runs load() once and stores it for ttlSec.
 * Answers that load() says are not worth keeping (shouldCache false) are returned but not stored, so a miss at the
 * source is retried soon instead of being remembered for the whole TTL.
 */
export async function cached<T>(key: string, ttlSec: number | ((v: T) => number), load: () => Promise<T>, shouldCache: (v: T) => boolean = () => true): Promise<T> {
  const k = `mini:${key}`;
  const hit = await read(k);
  if (hit != null) {
    try {
      return JSON.parse(hit) as T;
    } catch {
      /* corrupt entry, reload */
    }
  }
  const running = inflight.get(k) as Promise<T> | undefined;
  if (running) return running;
  const p = (async () => {
    try {
      const v = await load();
      if (shouldCache(v)) await write(k, JSON.stringify(v), typeof ttlSec === "function" ? ttlSec(v) : ttlSec);
      return v;
    } finally {
      inflight.delete(k);
    }
  })();
  inflight.set(k, p);
  return p;
}

// ---- Durable values --------------------------------------------------------------------------------------------------
// Lists that take a while to build (stocks, majors) are saved so a restart does not make the first visitor wait for them.
// Redis first. Without Redis they go to a small file in the temp folder, which keeps them across local restarts. A deploy
// to a host with a fresh disk needs Redis for this, otherwise the first build happens again after each deploy.
const DISK_DIR = join(tmpdir(), "loofta-mini-cache");
const diskFile = (key: string) => join(DISK_DIR, key.replace(/[^a-zA-Z0-9_-]/g, "_") + ".json");

/** A value saved with sharedSet, or null if there is none or it has expired. */
export async function sharedGet<T>(key: string): Promise<T | null> {
  const hit = await read(`mini:${key}`);
  if (hit != null) {
    try {
      return JSON.parse(hit) as T;
    } catch {
      /* fall through to disk */
    }
  }
  try {
    const f = JSON.parse(readFileSync(diskFile(key), "utf8")) as { exp: number; value: T };
    return f.exp > Date.now() ? f.value : null;
  } catch {
    return null;
  }
}

export async function sharedSet(key: string, value: unknown, ttlSec: number): Promise<void> {
  await write(`mini:${key}`, JSON.stringify(value), ttlSec);
  try {
    mkdirSync(DISK_DIR, { recursive: true });
    writeFileSync(diskFile(key), JSON.stringify({ exp: Date.now() + ttlSec * 1000, value }));
  } catch {
    /* disk is a bonus, never an error */
  }
}
