import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

describe('RedisService', () => {
  let service: RedisService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'REDIS_URL') return 'redis://localhost:6379';
      return null;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('when Redis is not configured', () => {
    beforeEach(async () => {
      mockConfigService.get.mockReturnValue(null);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RedisService,
          {
            provide: ConfigService,
            useValue: mockConfigService,
          },
        ],
      }).compile();

      service = module.get<RedisService>(RedisService);
      await service.onModuleInit();
    });

    it('should return false for isAvailable', () => {
      expect(service.isAvailable()).toBe(false);
    });

    it('should return null for get operations', async () => {
      const result = await service.get('test-key');
      expect(result).toBeNull();
    });

    it('should handle set operations gracefully', async () => {
      await expect(service.set('test-key', 'test-value')).resolves.not.toThrow();
    });
  });
});
