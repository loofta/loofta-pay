import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SupabaseService } from '@/database/supabase.service';
import { RedisService } from '@/redis/redis.service';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  services: {
    database: 'up' | 'down';
    redis: 'up' | 'down' | 'disabled';
  };
}

@ApiTags('health')
@Controller()
export class HealthController {
  private readonly startTime = Date.now();

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Basic health check
   */
  @Get('health')
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  async getHealth(): Promise<HealthStatus> {
    const dbStatus = await this.checkDatabase();
    const redisStatus = this.checkRedis();

    const status =
      dbStatus === 'down'
        ? 'unhealthy'
        : redisStatus === 'down'
          ? 'degraded'
          : 'healthy';

    return {
      status,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.1.0',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      services: {
        database: dbStatus,
        redis: redisStatus,
      },
    };
  }

  /**
   * Kubernetes liveness probe
   */
  @Get('healthz')
  @ApiOperation({ summary: 'Kubernetes liveness probe' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  async getLiveness(): Promise<{ status: string }> {
    return { status: 'ok' };
  }

  /**
   * Kubernetes readiness probe
   */
  @Get('ready')
  @ApiOperation({ summary: 'Kubernetes readiness probe' })
  @ApiResponse({ status: 200, description: 'Service is ready' })
  @ApiResponse({ status: 503, description: 'Service is not ready' })
  async getReadiness(): Promise<{ status: string }> {
    const dbStatus = await this.checkDatabase();
    
    if (dbStatus === 'down') {
      throw new Error('Database not ready');
    }

    return { status: 'ready' };
  }

  /**
   * Root endpoint
   */
  @Get()
  @ApiOperation({ summary: 'API information' })
  @ApiResponse({ status: 200, description: 'API information' })
  getRoot(): {
    name: string;
    version: string;
    docs: string;
  } {
    return {
      name: 'Loofta Swap API',
      version: process.env.npm_package_version || '0.1.0',
      docs: '/api/docs',
    };
  }

  /**
   * Check database connectivity
   */
  private async checkDatabase(): Promise<'up' | 'down'> {
    try {
      const client = this.supabaseService.getClient();
      // Simple query to verify connection
      const { error } = await client.from('organizations').select('id').limit(1);
      return error ? 'down' : 'up';
    } catch {
      return 'down';
    }
  }

  /**
   * Check Redis connectivity
   */
  private checkRedis(): 'up' | 'down' | 'disabled' {
    if (!this.redisService.isAvailable()) {
      // Check if Redis was configured
      const client = this.redisService.getClient();
      return client === null ? 'disabled' : 'down';
    }
    return 'up';
  }
}
