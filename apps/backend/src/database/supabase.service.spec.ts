import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from './supabase.service';

describe('SupabaseService', () => {
  let service: SupabaseService;
  let configService: ConfigService;

  const mockConfig: Record<string, string> = {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SECRET: 'test-secret-key',
  };

  const mockConfigService = {
    get: jest.fn((key: string) => mockConfig[key]),
    getOrThrow: jest.fn((key: string) => {
      const value = mockConfig[key];
      if (!value) throw new Error(`Configuration key "${key}" does not exist`);
      return value;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupabaseService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<SupabaseService>(SupabaseService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should initialize Supabase client on module init', () => {
    service.onModuleInit();
    expect(configService.getOrThrow).toHaveBeenCalledWith('SUPABASE_URL');
    // Now uses get() with fallback instead of getOrThrow
    expect(configService.get).toHaveBeenCalledWith('SUPABASE_SECRET');
  });

  it('should return the Supabase client', () => {
    service.onModuleInit();
    const client = service.getClient();
    expect(client).toBeDefined();
  });

  it('should provide table accessors', () => {
    service.onModuleInit();
    expect(service.organizations).toBeDefined();
    expect(service.claims).toBeDefined();
    expect(service.claimIntents).toBeDefined();
    expect(service.users).toBeDefined();
  });
});
