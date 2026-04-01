import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrivyVerificationService } from './privy-verification.service';
import { RedisService } from '@/redis/redis.service';

// --- Mock @privy-io/server-auth RPC ---
const mockVerifyAuthToken = jest.fn();
const mockGetUser = jest.fn();

jest.mock('@privy-io/server-auth', () => ({
  PrivyClient: jest.fn().mockImplementation(() => ({
    verifyAuthToken: mockVerifyAuthToken,
    getUser: mockGetUser,
  })),
}));

// --- Helpers ---
const VALID_USER_ID = 'did:privy:abc123';
const VALID_TOKEN = 'eyJhbGciOiJFUzI1NiJ9.valid.token';

function makeMockRedis(overrides: Partial<RedisService> = {}): jest.Mocked<RedisService> {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
    isAvailable: jest.fn().mockReturnValue(true),
    getClient: jest.fn().mockReturnValue(null),
    sAdd: jest.fn(),
    sMembers: jest.fn(),
    sRem: jest.fn(),
    acquireLock: jest.fn(),
    releaseLock: jest.fn(),
    withLock: jest.fn(),
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
    ...overrides,
  } as unknown as jest.Mocked<RedisService>;
}

function makeConfigService(withCredentials = true): Partial<ConfigService> {
  return {
    get: jest.fn((key: string) => {
      if (!withCredentials) return undefined;
      if (key === 'PRIVY_APP_ID') return 'test-app-id';
      if (key === 'PRIVY_APP_SECRET') return 'test-app-secret';
      return undefined;
    }),
  };
}

describe('PrivyVerificationService', () => {
  let service: PrivyVerificationService;
  let redis: jest.Mocked<RedisService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    redis = makeMockRedis();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrivyVerificationService,
        { provide: ConfigService, useValue: makeConfigService() },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get<PrivyVerificationService>(PrivyVerificationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(service.isConfigured).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────
  // verifyAccessToken
  // ────────────────────────────────────────────────────────────────
  describe('verifyAccessToken', () => {
    it('returns userId when Privy JWT is valid', async () => {
      mockVerifyAuthToken.mockResolvedValueOnce({ userId: VALID_USER_ID });

      const result = await service.verifyAccessToken(VALID_TOKEN);

      expect(result).toBe(VALID_USER_ID);
      expect(mockVerifyAuthToken).toHaveBeenCalledWith(VALID_TOKEN);
    });

    it('returns null when JWT is expired or invalid', async () => {
      mockVerifyAuthToken.mockRejectedValueOnce(new Error('Token expired'));

      const result = await service.verifyAccessToken('bad.token');

      expect(result).toBeNull();
    });

    it('returns null when JWT is structurally malformed', async () => {
      mockVerifyAuthToken.mockRejectedValueOnce(new Error('invalid_token'));

      const result = await service.verifyAccessToken('not-a-jwt');

      expect(result).toBeNull();
    });
  });

  describe('verifyAccessToken — Privy not configured', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PrivyVerificationService,
          { provide: ConfigService, useValue: makeConfigService(false) },
          { provide: RedisService, useValue: redis },
        ],
      }).compile();
      service = module.get(PrivyVerificationService);
    });

    it('returns null when Privy credentials are not set', async () => {
      const result = await service.verifyAccessToken(VALID_TOKEN);
      expect(result).toBeNull();
      expect(mockVerifyAuthToken).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // verifyUserId (legacy header — Privy API call with Redis cache)
  // ────────────────────────────────────────────────────────────────
  describe('verifyUserId', () => {
    it('returns true when Privy API confirms the user exists', async () => {
      mockGetUser.mockResolvedValueOnce({ id: VALID_USER_ID });

      const result = await service.verifyUserId(VALID_USER_ID);

      expect(result).toBe(true);
      expect(mockGetUser).toHaveBeenCalledWith(VALID_USER_ID);
    });

    it('caches a positive lookup in Redis for 5 minutes', async () => {
      mockGetUser.mockResolvedValueOnce({ id: VALID_USER_ID });

      await service.verifyUserId(VALID_USER_ID);

      expect(redis.set).toHaveBeenCalledWith(
        `privy:user:exists:${VALID_USER_ID}`,
        '1',
        300,
      );
    });

    it('returns the cached Redis value without calling Privy API again', async () => {
      redis.get = jest.fn().mockResolvedValueOnce('1');

      const result = await service.verifyUserId(VALID_USER_ID);

      expect(result).toBe(true);
      expect(mockGetUser).not.toHaveBeenCalled();
    });

    it('returns false and caches negative when user does not exist in Privy', async () => {
      mockGetUser.mockRejectedValueOnce(new Error('User not found'));

      const result = await service.verifyUserId(VALID_USER_ID);

      expect(result).toBe(false);
      expect(redis.set).toHaveBeenCalledWith(
        `privy:user:exists:${VALID_USER_ID}`,
        '0',
        60,
      );
    });

    it('returns false for an ID that does not start with did:privy:', async () => {
      const result = await service.verifyUserId('some-random-id');
      expect(result).toBe(false);
      expect(mockGetUser).not.toHaveBeenCalled();
    });

    it('returns false for empty input', async () => {
      const result = await service.verifyUserId('');
      expect(result).toBe(false);
    });
  });

  describe('verifyUserId — Privy not configured (local dev)', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PrivyVerificationService,
          { provide: ConfigService, useValue: makeConfigService(false) },
          { provide: RedisService, useValue: redis },
        ],
      }).compile();
      service = module.get(PrivyVerificationService);
    });

    it('trusts any did:privy: header when Privy is not configured (local dev mode)', async () => {
      const result = await service.verifyUserId(VALID_USER_ID);
      expect(result).toBe(true);
      expect(mockGetUser).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // getPrivyUser (Privy API + Redis cache)
  // ────────────────────────────────────────────────────────────────
  describe('getPrivyUser', () => {
    const mockLinkedAccounts = [
      { type: 'wallet', address: '9XyBmfW3zYqKMv8LzDnAr5Pm7oGQwCxHuJt4SdEpV2' },
    ];

    it('returns linked accounts from Privy API', async () => {
      mockGetUser.mockResolvedValueOnce({ linkedAccounts: mockLinkedAccounts });

      const result = await service.getPrivyUser(VALID_USER_ID);

      expect(result).not.toBeNull();
      expect(result!.linked_accounts).toHaveLength(1);
      expect(result!.linked_accounts[0].address).toBe(mockLinkedAccounts[0].address);
    });

    it('caches the Privy user data in Redis', async () => {
      mockGetUser.mockResolvedValueOnce({ linkedAccounts: mockLinkedAccounts });

      await service.getPrivyUser(VALID_USER_ID);

      expect(redis.set).toHaveBeenCalledWith(
        `privy:user:data:${VALID_USER_ID}`,
        expect.any(String),
        300,
      );
    });

    it('returns cached data from Redis without calling Privy API', async () => {
      const cached = JSON.stringify({ linked_accounts: mockLinkedAccounts });
      redis.get = jest.fn().mockResolvedValueOnce(cached);

      const result = await service.getPrivyUser(VALID_USER_ID);

      expect(result!.linked_accounts).toHaveLength(1);
      expect(mockGetUser).not.toHaveBeenCalled();
    });

    it('returns null when Privy API throws', async () => {
      mockGetUser.mockRejectedValueOnce(new Error('Network error'));

      const result = await service.getPrivyUser(VALID_USER_ID);

      expect(result).toBeNull();
    });

    it('returns null for non-Privy user IDs', async () => {
      const result = await service.getPrivyUser('random-user-id');
      expect(result).toBeNull();
      expect(mockGetUser).not.toHaveBeenCalled();
    });
  });
});
