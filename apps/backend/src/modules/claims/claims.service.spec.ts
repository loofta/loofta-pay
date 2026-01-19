import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClaimsService } from './claims.service';
import { SupabaseService } from '@/database/supabase.service';
import { CreateClaimDto } from './dto';

describe('ClaimsService', () => {
  let service: ClaimsService;

  const mockClaim = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    amount: '100',
    to_symbol: 'USDC',
    to_chain: 'base',
    recipient_address: '0x1234567890abcdef1234567890abcdef12345678',
    created_by: 'did:privy:user123',
    creator_email: 'user@example.com',
    status: 'OPEN',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: null,
  };

  const mockClaimIntent = {
    id: '987e6543-e21b-12d3-a456-426614174001',
    claim_id: mockClaim.id,
    quote_id: 'quote_123',
    deposit_address: '0xabcdef...',
    memo: null,
    deadline: '2024-01-01T01:00:00Z',
    time_estimate: 300,
    status: 'PENDING_DEPOSIT',
    from_chain: 'eth',
    to_chain: 'base',
    created_at: '2024-01-01T00:00:00Z',
  };

  const mockSupabaseClaims = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn(),
    maybeSingle: jest.fn(),
  };

  const mockSupabaseClaimIntents = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn(),
    maybeSingle: jest.fn(),
  };

  const mockSupabaseService = {
    claims: mockSupabaseClaims,
    claimIntents: mockSupabaseClaimIntents,
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      if (key === 'NEXT_PUBLIC_BASE_URL') return 'https://pay.loofta.xyz';
      return defaultValue;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimsService,
        {
          provide: SupabaseService,
          useValue: mockSupabaseService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<ClaimsService>(ClaimsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const createDto: CreateClaimDto = {
      amount: 100,
      toSel: { symbol: 'USDC', chain: 'base' },
      recipient: '0x1234567890abcdef1234567890abcdef12345678',
      userId: 'did:privy:user123',
      userEmail: 'user@example.com',
    };

    it('should create a new claim', async () => {
      mockSupabaseClaims.single.mockResolvedValueOnce({
        data: { id: mockClaim.id },
        error: null,
      });

      const result = await service.create(createDto);

      expect(result.id).toBe(mockClaim.id);
      expect(result.link).toBe(`https://pay.loofta.xyz/c/${mockClaim.id}`);
    });

    it('should throw BadRequestException for missing fields', async () => {
      await expect(
        service.create({ ...createDto, amount: 0 } as CreateClaimDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw error on database failure', async () => {
      mockSupabaseClaims.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database error' },
      });

      await expect(service.create(createDto)).rejects.toThrow('Database error');
    });
  });

  describe('findOne', () => {
    it('should return claim by ID', async () => {
      mockSupabaseClaims.single.mockResolvedValueOnce({
        data: mockClaim,
        error: null,
      });

      const result = await service.findOne(mockClaim.id);

      expect(result.id).toBe(mockClaim.id);
      expect(result.to_symbol).toBe('USDC');
    });

    it('should throw NotFoundException when claim not found', async () => {
      mockSupabaseClaims.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Not found' },
      });

      await expect(service.findOne('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findWithLatestIntent', () => {
    it('should return claim with latest intent', async () => {
      mockSupabaseClaims.single.mockResolvedValueOnce({
        data: mockClaim,
        error: null,
      });
      mockSupabaseClaimIntents.maybeSingle.mockResolvedValueOnce({
        data: mockClaimIntent,
        error: null,
      });

      const result = await service.findWithLatestIntent(mockClaim.id);

      expect(result.claim.id).toBe(mockClaim.id);
      expect(result.intent?.quote_id).toBe('quote_123');
    });

    it('should return claim with null intent if no intents exist', async () => {
      mockSupabaseClaims.single.mockResolvedValueOnce({
        data: mockClaim,
        error: null,
      });
      mockSupabaseClaimIntents.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const result = await service.findWithLatestIntent(mockClaim.id);

      expect(result.claim.id).toBe(mockClaim.id);
      expect(result.intent).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('should update claim status', async () => {
      mockSupabaseClaims.single.mockResolvedValueOnce({
        data: { ...mockClaim, status: 'IN_FLIGHT' },
        error: null,
      });

      const result = await service.updateStatus(mockClaim.id, 'IN_FLIGHT');

      expect(result.status).toBe('IN_FLIGHT');
    });
  });

  describe('createIntent', () => {
    it('should create claim intent and update claim status', async () => {
      mockSupabaseClaimIntents.single.mockResolvedValueOnce({
        data: mockClaimIntent,
        error: null,
      });
      mockSupabaseClaims.single.mockResolvedValueOnce({
        data: { ...mockClaim, status: 'PENDING_DEPOSIT' },
        error: null,
      });

      const result = await service.createIntent({
        claimId: mockClaim.id,
        quoteId: 'quote_123',
        depositAddress: '0xabcdef...',
        fromChain: 'eth',
        toChain: 'base',
      });

      expect(result.claim_id).toBe(mockClaim.id);
      expect(result.quote_id).toBe('quote_123');
    });
  });

  describe('getPendingIntents', () => {
    it('should return pending intents', async () => {
      mockSupabaseClaimIntents.order.mockResolvedValueOnce({
        data: [mockClaimIntent],
        error: null,
      });

      const result = await service.getPendingIntents();

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('PENDING_DEPOSIT');
    });

    it('should return empty array when no pending intents', async () => {
      mockSupabaseClaimIntents.order.mockResolvedValueOnce({
        data: [],
        error: null,
      });

      const result = await service.getPendingIntents();

      expect(result).toHaveLength(0);
    });
  });
});
