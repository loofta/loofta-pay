import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClaimsService } from './claims.service';
import { SupabaseService } from '@/database/supabase.service';
import { UsersService } from '../users/users.service';
import { SolanaSponsorService } from './solana-sponsor.service';
import { CreateClaimDto } from './dto';

// ────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────

const CLAIM_ID = '123e4567-e89b-12d3-a456-426614174000';
const CREATOR_ID = 'did:privy:creator123';
const ATTACKER_ID = 'did:privy:attacker999';
const RECIPIENT_WALLET = '9XyBmfW3zYqKMv8LzDnAr5Pm7oGQwCxHuJt4SdEpV2';

const mockClaim = {
  id: CLAIM_ID,
  amount: '100',
  to_symbol: 'USDC',
  to_chain: 'solana',
  recipient_address: RECIPIENT_WALLET,
  created_by: CREATOR_ID,
  creator_email: null,
  status: 'OPEN',
  is_private: false,
  claim_burner_address: null,
  claim_burner_encrypted_secret: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockClaimIntent = {
  id: '987e6543-e21b-12d3-a456-426614174001',
  claim_id: CLAIM_ID,
  quote_id: 'quote_123',
  deposit_address: '0xabcdef...',
  memo: null,
  deadline: '2024-01-01T01:00:00Z',
  time_estimate: 300,
  status: 'PENDING_DEPOSIT',
  from_chain: 'eth',
  to_chain: 'solana',
  created_at: '2024-01-01T00:00:00Z',
};

// ────────────────────────────────────────────────────────────────
// Supabase builder mock
//
// Chain methods (select, eq, gte, …) return `this` so tests can
// build fluent chains. The mock is also thenable so queries that
// DON'T end with .single()/.maybeSingle() can be `await`-ed
// directly (e.g. cronSweepPendingBurners, getPendingIntents).
//
// Use _setResolve({ data, error }) to configure the thenable result
// before each test that needs direct await semantics.
// ────────────────────────────────────────────────────────────────

function makeChainMock() {
  // Default thenable value — tests that need a different response call _setResolve()
  let _thenableData: { data: any; error: any } = { data: null, error: null };

  const mock: any = {
    // Helpers used in individual tests
    _setResolve: (d: { data: any; error: any }) => { _thenableData = d; },
    _resetResolve: () => { _thenableData = { data: null, error: null }; },
  };

  // All Supabase filter/chain methods return `this` so chains like
  // .select().eq().gte().not() all work without extra configuration.
  const chainMethods = [
    'select', 'insert', 'update', 'upsert',
    'eq', 'neq', 'in', 'not', 'is',
    'gte', 'gt', 'lte', 'lt',
    'ilike', 'order', 'limit', 'range',
  ];
  chainMethods.forEach((m) => (mock[m] = jest.fn().mockReturnThis()));

  // Terminating methods — resolved individually per test via mockResolvedValueOnce
  mock.single = jest.fn();
  mock.maybeSingle = jest.fn();

  // Make the mock a thenable so `await mock.chainMethod(...)` works
  // when no .single()/.maybeSingle() is called (direct await on the builder).
  mock.then = function (
    onFulfilled: (val: any) => any,
    onRejected: (err: any) => any,
  ) {
    return Promise.resolve(_thenableData).then(onFulfilled, onRejected);
  };

  return mock;
}

const mockSupabaseClaims = makeChainMock();
const mockSupabaseClaimIntents = makeChainMock();

const mockSupabaseService = {
  claims: mockSupabaseClaims,
  claimIntents: mockSupabaseClaimIntents,
};

const mockConfigService = {
  get: jest.fn((key: string, defaultValue?: string) => {
    if (key === 'NEXT_PUBLIC_BASE_URL') return 'https://pay.loofta.xyz';
    if (key === 'SOLANA_USDC_MINT') return 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    if (key === 'PER_PROGRAM_ID') return 'EQMRkmeCbzZaXyEDwgqiTqgg8kUjxBXPe616odmPjSwL';
    return defaultValue;
  }),
};

const mockUsersService = {
  findByPrivyId: jest.fn().mockResolvedValue({ username: 'testuser' }),
  getSolanaWalletAddress: jest.fn().mockResolvedValue(RECIPIENT_WALLET),
  findByUsername: jest.fn().mockResolvedValue({
    id: 'user-uuid',
    privyUserId: CREATOR_ID,
    username: 'testuser',
  }),
  findByEmail: jest.fn().mockResolvedValue({
    id: 'user-uuid',
    privyUserId: CREATOR_ID,
    username: 'testuser',
  }),
};

const mockSolanaSponsor = {
  isAvailable: jest.fn().mockReturnValue(false),
  getFeePayerAddress: jest.fn().mockReturnValue(null),
  getFeePayerKeypair: jest.fn().mockReturnValue(null),
  getConnection: jest.fn().mockReturnValue(null),
  prepareSponsoredTransaction: jest.fn(),
  signAndBroadcast: jest.fn(),
};

// ────────────────────────────────────────────────────────────────
// Module setup
// ────────────────────────────────────────────────────────────────

describe('ClaimsService', () => {
  let service: ClaimsService;

  beforeEach(async () => {
    // resetAllMocks clears queued mockResolvedValueOnce values too (clearAllMocks does not)
    jest.resetAllMocks();
    mockSupabaseClaims._resetResolve();
    mockSupabaseClaimIntents._resetResolve();

    // Re-seed chain methods so fluent builders keep returning `this`
    const CHAIN = [
      'select', 'insert', 'update', 'upsert', 'eq', 'neq', 'in', 'not', 'is',
      'gte', 'gt', 'lte', 'lt', 'ilike', 'order', 'limit', 'range',
    ];
    CHAIN.forEach((m) => {
      mockSupabaseClaims[m].mockReturnThis();
      mockSupabaseClaimIntents[m].mockReturnThis();
    });

    // Re-seed config + service-level mocks (resetAllMocks clears jest.fn implementations)
    mockConfigService.get.mockImplementation((key: string, defaultValue?: string) => {
      if (key === 'NEXT_PUBLIC_BASE_URL') return 'https://pay.loofta.xyz';
      if (key === 'SOLANA_USDC_MINT') return 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      if (key === 'PER_PROGRAM_ID') return 'EQMRkmeCbzZaXyEDwgqiTqgg8kUjxBXPe616odmPjSwL';
      return defaultValue;
    });

    mockUsersService.findByPrivyId.mockResolvedValue({ username: 'testuser' });
    mockUsersService.getSolanaWalletAddress.mockResolvedValue(RECIPIENT_WALLET);
    mockUsersService.findByUsername.mockResolvedValue({
      id: 'user-uuid', privyUserId: CREATOR_ID, username: 'testuser',
    });
    mockUsersService.findByEmail.mockResolvedValue({
      id: 'user-uuid', privyUserId: CREATOR_ID, username: 'testuser',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimsService,
        { provide: SupabaseService, useValue: mockSupabaseService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: UsersService, useValue: mockUsersService },
        { provide: SolanaSponsorService, useValue: mockSolanaSponsor },
        // SendPaymentEncryptionService is @Optional() — omit to simulate unconfigured
      ],
    }).compile();

    service = module.get<ClaimsService>(ClaimsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ────────────────────────────────────────────────────────────────
  // create
  // ────────────────────────────────────────────────────────────────

  describe('create', () => {
    const createDto: CreateClaimDto = {
      amount: 100,
      toSel: { symbol: 'USDC', chain: 'solana' },
      recipient: RECIPIENT_WALLET,
      userId: CREATOR_ID,
    };

    it('creates a claim and returns id + link', async () => {
      mockSupabaseClaims.single.mockResolvedValueOnce({
        data: { id: CLAIM_ID },
        error: null,
      });

      const result = await service.create(createDto);

      expect(result.id).toBe(CLAIM_ID);
      expect(result.link).toBe(`https://pay.loofta.xyz/c/${CLAIM_ID}`);
    });

    it('throws BadRequestException for amount of 0', async () => {
      await expect(
        service.create({ ...createDto, amount: 0 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws on database insert failure', async () => {
      mockSupabaseClaims.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database error' },
      });

      await expect(service.create(createDto)).rejects.toThrow('Database error');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // findOne
  // ────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns claim by ID and enriches creator_username', async () => {
      mockSupabaseClaims.single.mockResolvedValueOnce({ data: mockClaim, error: null });
      mockUsersService.findByPrivyId.mockResolvedValueOnce({ username: 'alice' });

      const result = await service.findOne(CLAIM_ID);

      expect(result.id).toBe(CLAIM_ID);
      expect((result as any).creator_username).toBe('alice');
    });

    it('throws NotFoundException when claim does not exist', async () => {
      mockSupabaseClaims.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Not found' },
      });

      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for DELETED claims', async () => {
      mockSupabaseClaims.single.mockResolvedValueOnce({
        data: { ...mockClaim, status: 'DELETED' },
        error: null,
      });

      await expect(service.findOne(CLAIM_ID)).rejects.toThrow("This payment doesn't exist.");
    });

    it('masks PENDING_EMAIL recipient address and exposes flag', async () => {
      const pendingClaim = {
        ...mockClaim,
        recipient_address: 'PENDING_EMAIL:alice@example.com',
        claim_burner_address: null,
      };
      mockSupabaseClaims.single.mockResolvedValueOnce({ data: pendingClaim, error: null });
      // backfillBurnerForClaim calls update — simulate no encryption key (returns null)
      mockSupabaseClaims.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

      const result = await service.findOne(CLAIM_ID);

      expect((result as any).recipient_address).toBeUndefined();
      expect((result as any).recipient_pending_email).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // findWithLatestIntent
  // ────────────────────────────────────────────────────────────────

  describe('findWithLatestIntent', () => {
    it('returns claim with latest intent', async () => {
      mockSupabaseClaims.single.mockResolvedValueOnce({ data: mockClaim, error: null });
      mockSupabaseClaimIntents.maybeSingle.mockResolvedValueOnce({
        data: mockClaimIntent,
        error: null,
      });

      const result = await service.findWithLatestIntent(CLAIM_ID);

      expect(result.claim.id).toBe(CLAIM_ID);
      expect(result.intent?.quote_id).toBe('quote_123');
    });

    it('returns null intent when no intent exists for the claim', async () => {
      mockSupabaseClaims.single.mockResolvedValueOnce({ data: mockClaim, error: null });
      mockSupabaseClaimIntents.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

      const result = await service.findWithLatestIntent(CLAIM_ID);

      expect(result.claim.id).toBe(CLAIM_ID);
      expect(result.intent).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // updateStatus — core transitions
  // ────────────────────────────────────────────────────────────────

  describe('updateStatus', () => {
    it('updates status to IN_FLIGHT without any ownership check', async () => {
      mockSupabaseClaims.single.mockResolvedValueOnce({
        data: { ...mockClaim, status: 'IN_FLIGHT' },
        error: null,
      });

      const result = await service.updateStatus(CLAIM_ID, 'IN_FLIGHT');

      expect(result.status).toBe('IN_FLIGHT');
    });

    it('sets paid_at when marking SUCCESS', async () => {
      // No createdByUserId passed → backfill maybeSingle is skipped; only 1 maybeSingle needed
      mockSupabaseClaims.maybeSingle
        .mockResolvedValueOnce({ data: { recipient_address: RECIPIENT_WALLET }, error: null });
      mockSupabaseClaims.single.mockResolvedValueOnce({
        data: { ...mockClaim, status: 'SUCCESS', paid_at: expect.any(String) },
        error: null,
      });

      const result = await service.updateStatus(CLAIM_ID, 'SUCCESS');

      expect(result.status).toBe('SUCCESS');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // updateStatus — CANCELLED ownership check (security fix)
  // ────────────────────────────────────────────────────────────────

  describe('updateStatus CANCELLED — ownership check', () => {
    it('allows CANCELLED when no callerUserId is provided (bridge/anonymous flow)', async () => {
      mockSupabaseClaims.single.mockResolvedValueOnce({
        data: { ...mockClaim, status: 'CANCELLED' },
        error: null,
      });

      const result = await service.updateStatus(CLAIM_ID, 'CANCELLED', undefined, undefined);

      expect(result.status).toBe('CANCELLED');
      // maybeSingle (ownership query) should NOT have been called
      expect(mockSupabaseClaims.maybeSingle).not.toHaveBeenCalled();
    });

    it('allows CANCELLED when the caller IS the creator', async () => {
      mockSupabaseClaims.maybeSingle.mockResolvedValueOnce({
        data: { created_by: CREATOR_ID },
        error: null,
      });
      mockSupabaseClaims.single.mockResolvedValueOnce({
        data: { ...mockClaim, status: 'CANCELLED' },
        error: null,
      });

      const result = await service.updateStatus(CLAIM_ID, 'CANCELLED', undefined, CREATOR_ID);

      expect(result.status).toBe('CANCELLED');
    });

    it('throws ForbiddenException when the caller is NOT the creator', async () => {
      mockSupabaseClaims.maybeSingle.mockResolvedValueOnce({
        data: { created_by: CREATOR_ID },
        error: null,
      });

      await expect(
        service.updateStatus(CLAIM_ID, 'CANCELLED', undefined, ATTACKER_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException with a clear message for a bad-actor cancel attempt', async () => {
      mockSupabaseClaims.maybeSingle.mockResolvedValueOnce({
        data: { created_by: CREATOR_ID },
        error: null,
      });

      await expect(
        service.updateStatus(CLAIM_ID, 'CANCELLED', undefined, ATTACKER_ID),
      ).rejects.toThrow('Only the claim creator can cancel this payment');
    });

    it('allows CANCELLED when the claim has no creator (anonymous payment)', async () => {
      mockSupabaseClaims.maybeSingle.mockResolvedValueOnce({
        data: { created_by: null },
        error: null,
      });
      mockSupabaseClaims.single.mockResolvedValueOnce({
        data: { ...mockClaim, created_by: null, status: 'CANCELLED' },
        error: null,
      });

      // Even with a callerUserId, if the claim has no owner we allow it
      const result = await service.updateStatus(CLAIM_ID, 'CANCELLED', undefined, ATTACKER_ID);

      expect(result.status).toBe('CANCELLED');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // cronSweepPendingBurners
  // ────────────────────────────────────────────────────────────────

  describe('cronSweepPendingBurners', () => {
    /** Spy on the private sweepClaimBurnerToWallet method */
    function spySweep(resolved: { sweepTxHash?: string; sweptAmount?: string }) {
      return jest
        .spyOn(service as any, 'sweepClaimBurnerToWallet')
        .mockResolvedValue(resolved);
    }

    it('does nothing when there are no PRIVATE_TRANSFER_PENDING claims', async () => {
      mockSupabaseClaims._setResolve({ data: [], error: null });
      const spy = spySweep({});

      await service.cronSweepPendingBurners();

      expect(spy).not.toHaveBeenCalled();
    });

    it('skips claims whose recipient is still PENDING_EMAIL', async () => {
      mockSupabaseClaims._setResolve({
        data: [{
          ...mockClaim,
          status: 'PRIVATE_TRANSFER_PENDING',
          recipient_address: 'PENDING_EMAIL:user@example.com',
          claim_burner_address: 'burner_addr',
          claim_burner_encrypted_secret: 'enc_secret',
        }],
        error: null,
      });
      const spy = spySweep({});

      await service.cronSweepPendingBurners();

      expect(spy).not.toHaveBeenCalled();
    });

    it('sweeps and marks SUCCESS when a resolved-recipient claim has burner funds', async () => {
      const pendingClaim = {
        ...mockClaim,
        status: 'PRIVATE_TRANSFER_PENDING',
        recipient_address: RECIPIENT_WALLET,
        claim_burner_address: 'BurnerAbc123',
        claim_burner_encrypted_secret: 'encrypted_key',
      };
      mockSupabaseClaims._setResolve({ data: [pendingClaim], error: null });

      const sweepSpy = spySweep({ sweepTxHash: 'tx_hash_abc', sweptAmount: '10.00' });

      // updateStatus → SUCCESS: ownership check + backfill check + final update
      mockSupabaseClaims.maybeSingle
        .mockResolvedValueOnce({ data: { recipient_address: RECIPIENT_WALLET }, error: null })
        .mockResolvedValueOnce({ data: { created_by: CREATOR_ID }, error: null });
      mockSupabaseClaims.single.mockResolvedValueOnce({
        data: { ...pendingClaim, status: 'SUCCESS' },
        error: null,
      });

      await service.cronSweepPendingBurners();

      expect(sweepSpy).toHaveBeenCalledWith(CLAIM_ID, pendingClaim, RECIPIENT_WALLET);
    });

    it('leaves status as PRIVATE_TRANSFER_PENDING when burner is still empty', async () => {
      const pendingClaim = {
        ...mockClaim,
        status: 'PRIVATE_TRANSFER_PENDING',
        recipient_address: RECIPIENT_WALLET,
        claim_burner_address: 'BurnerAbc123',
        claim_burner_encrypted_secret: 'encrypted_key',
      };
      mockSupabaseClaims._setResolve({ data: [pendingClaim], error: null });
      const sweepSpy = spySweep({}); // no sweepTxHash → burner still empty

      await service.cronSweepPendingBurners();

      expect(sweepSpy).toHaveBeenCalled();
      // updateStatus should NOT have been called (no tx to mark SUCCESS)
      expect(mockSupabaseClaims.single).not.toHaveBeenCalled();
    });

    it('continues processing other claims when one sweep throws (Solana RPC error)', async () => {
      const badClaim = {
        ...mockClaim, id: 'bad-claim-id', status: 'PRIVATE_TRANSFER_PENDING',
        recipient_address: RECIPIENT_WALLET,
        claim_burner_address: 'Burner2', claim_burner_encrypted_secret: 'enc2',
      };
      const goodClaim = {
        ...mockClaim, id: 'good-claim-id', status: 'PRIVATE_TRANSFER_PENDING',
        recipient_address: RECIPIENT_WALLET,
        claim_burner_address: 'Burner1', claim_burner_encrypted_secret: 'enc1',
      };
      mockSupabaseClaims._setResolve({ data: [badClaim, goodClaim], error: null });

      const sweepSpy = jest
        .spyOn(service as any, 'sweepClaimBurnerToWallet')
        .mockRejectedValueOnce(new Error('Solana RPC error'))
        .mockResolvedValueOnce({ sweepTxHash: 'tx_ok' });

      // updateStatus for goodClaim
      mockSupabaseClaims.maybeSingle
        .mockResolvedValueOnce({ data: { recipient_address: RECIPIENT_WALLET }, error: null })
        .mockResolvedValueOnce({ data: { created_by: CREATOR_ID }, error: null });
      mockSupabaseClaims.single.mockResolvedValueOnce({
        data: { ...goodClaim, status: 'SUCCESS' }, error: null,
      });

      await service.cronSweepPendingBurners(); // must not throw

      expect(sweepSpy).toHaveBeenCalledTimes(2);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // createIntent
  // ────────────────────────────────────────────────────────────────

  describe('createIntent', () => {
    it('creates intent record and updates claim to PENDING_DEPOSIT', async () => {
      mockSupabaseClaimIntents.single.mockResolvedValueOnce({
        data: mockClaimIntent,
        error: null,
      });
      // updateStatus for PENDING_DEPOSIT: single update call
      mockSupabaseClaims.single.mockResolvedValueOnce({
        data: { ...mockClaim, status: 'PENDING_DEPOSIT' },
        error: null,
      });

      const result = await service.createIntent({
        claimId: CLAIM_ID,
        quoteId: 'quote_123',
        depositAddress: '0xabcdef...',
        fromChain: 'eth',
        toChain: 'solana',
      });

      expect(result.claim_id).toBe(CLAIM_ID);
      expect(result.quote_id).toBe('quote_123');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // getPendingIntents
  // ────────────────────────────────────────────────────────────────

  describe('getPendingIntents', () => {
    it('returns pending intents', async () => {
      mockSupabaseClaimIntents._setResolve({ data: [mockClaimIntent], error: null });

      const result = await service.getPendingIntents();

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('PENDING_DEPOSIT');
    });

    it('returns empty array when no pending intents exist', async () => {
      mockSupabaseClaimIntents._setResolve({ data: [], error: null });

      const result = await service.getPendingIntents();

      expect(result).toHaveLength(0);
    });
  });
});
