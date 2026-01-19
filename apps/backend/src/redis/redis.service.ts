import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    
    if (!redisUrl) {
      this.logger.warn('REDIS_URL not configured - Redis features disabled');
      return;
    }

    try {
      this.client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 3) return null;
          return Math.min(times * 200, 1000);
        },
      });

      this.client.on('connect', () => {
        this.logger.log('Redis connected');
      });

      this.client.on('error', (err) => {
        this.logger.error('Redis error:', err.message);
      });
    } catch (error) {
      this.logger.error('Failed to initialize Redis:', error);
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      this.logger.log('Redis connection closed');
    }
  }

  getClient(): Redis | null {
    return this.client;
  }

  isAvailable(): boolean {
    return this.client !== null && this.client.status === 'ready';
  }

  // Key-value operations
  async get(key: string): Promise<string | null> {
    if (!this.client) return null;
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.client) return;
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.client) return;
    await this.client.del(key);
  }

  // Set operations
  async sAdd(key: string, ...members: string[]): Promise<number> {
    if (!this.client) return 0;
    return this.client.sadd(key, ...members);
  }

  async sMembers(key: string): Promise<string[]> {
    if (!this.client) return [];
    return this.client.smembers(key);
  }

  async sRem(key: string, ...members: string[]): Promise<number> {
    if (!this.client) return 0;
    return this.client.srem(key, ...members);
  }

  // Distributed locking
  async acquireLock(key: string, ttlMs: number = 30000): Promise<string | null> {
    if (!this.client) return null;
    
    const lockValue = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const lockKey = `lock:${key}`;
    
    const result = await this.client.set(lockKey, lockValue, 'PX', ttlMs, 'NX');
    return result === 'OK' ? lockValue : null;
  }

  async releaseLock(key: string, lockValue: string): Promise<boolean> {
    if (!this.client) return false;
    
    const lockKey = `lock:${key}`;
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    
    const result = await this.client.eval(script, 1, lockKey, lockValue);
    return result === 1;
  }

  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    ttlMs: number = 30000,
  ): Promise<T | null> {
    const lockValue = await this.acquireLock(key, ttlMs);
    if (!lockValue) {
      this.logger.warn(`Failed to acquire lock: ${key}`);
      return null;
    }

    try {
      return await fn();
    } finally {
      await this.releaseLock(key, lockValue);
    }
  }
}
