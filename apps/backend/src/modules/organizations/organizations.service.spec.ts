import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { SupabaseService } from '@/database/supabase.service';
import { CreateOrganizationDto, CheckoutStatus } from './dto';

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let supabaseService: SupabaseService;

  const mockOrganization = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    organization_id: 'acme-corp',
    name: 'Acme Corporation',
    logo_url: 'https://example.com/logo.png',
    checkout_status: 'active',
    org_referral: 'org_abc123xyz789def0',
    recipient_wallet: '0x1234...abcd',
    token_symbol: 'USDC',
    token_chain: 'base',
    bg_color: '#1a1a1a',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: null,
  };

  // Create a chainable mock that properly returns itself
  const createChainableMock = () => {
    const mock: any = {
      select: jest.fn(),
      insert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      eq: jest.fn(),
      order: jest.fn(),
      single: jest.fn(),
      maybeSingle: jest.fn(),
    };
    // Each method returns the mock for chaining
    mock.select.mockReturnValue(mock);
    mock.insert.mockReturnValue(mock);
    mock.update.mockReturnValue(mock);
    mock.delete.mockReturnValue(mock);
    mock.eq.mockReturnValue(mock);
    mock.order.mockReturnValue(mock);
    return mock;
  };

  let mockSupabaseOrganizations: ReturnType<typeof createChainableMock>;

  const mockSupabaseService = {
    get organizations() {
      return mockSupabaseOrganizations;
    },
  };

  beforeEach(async () => {
    // Reset the chainable mock for each test
    mockSupabaseOrganizations = createChainableMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        {
          provide: SupabaseService,
          useValue: mockSupabaseService,
        },
      ],
    }).compile();

    service = module.get<OrganizationsService>(OrganizationsService);
    supabaseService = module.get<SupabaseService>(SupabaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all organizations', async () => {
      mockSupabaseOrganizations.order.mockResolvedValueOnce({
        data: [mockOrganization],
        error: null,
      });

      const result = await service.findAll();

      expect(result).toHaveLength(1);
      expect(result[0].organization_id).toBe('acme-corp');
    });

    it('should return empty array when no organizations', async () => {
      mockSupabaseOrganizations.order.mockResolvedValueOnce({
        data: [],
        error: null,
      });

      const result = await service.findAll();

      expect(result).toHaveLength(0);
    });

    it('should throw error on database failure', async () => {
      mockSupabaseOrganizations.order.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database error' },
      });

      await expect(service.findAll()).rejects.toThrow('Database error');
    });
  });

  describe('findOne', () => {
    it('should return organization by ID', async () => {
      mockSupabaseOrganizations.single.mockResolvedValueOnce({
        data: mockOrganization,
        error: null,
      });

      const result = await service.findOne(mockOrganization.id);

      expect(result.organization_id).toBe('acme-corp');
    });

    it('should throw NotFoundException when organization not found', async () => {
      mockSupabaseOrganizations.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Not found' },
      });

      await expect(service.findOne('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    const createDto: CreateOrganizationDto = {
      organization_id: 'new-org',
      name: 'New Organization',
      checkout_status: CheckoutStatus.ACTIVE,
    };

    it('should create a new organization', async () => {
      // Mock findByOrganizationId to return null (no existing org)
      mockSupabaseOrganizations.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      // Mock insert
      mockSupabaseOrganizations.single.mockResolvedValueOnce({
        data: { ...mockOrganization, ...createDto },
        error: null,
      });

      const result = await service.create(createDto);

      expect(result.organization_id).toBe('new-org');
    });

    it('should throw ConflictException when organization_id exists', async () => {
      mockSupabaseOrganizations.maybeSingle.mockResolvedValueOnce({
        data: mockOrganization,
        error: null,
      });

      await expect(
        service.create({ ...createDto, organization_id: 'acme-corp' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should generate unique referral code', async () => {
      mockSupabaseOrganizations.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      let capturedInsert: any;
      mockSupabaseOrganizations.insert.mockImplementationOnce((data: any) => {
        capturedInsert = data;
        return mockSupabaseOrganizations;
      });

      mockSupabaseOrganizations.single.mockResolvedValueOnce({
        data: { ...mockOrganization, ...createDto },
        error: null,
      });

      await service.create(createDto);

      expect(capturedInsert.org_referral).toMatch(/^org_[a-z0-9]{16}$/);
    });
  });

  describe('update', () => {
    it('should update organization', async () => {
      // Mock findOne
      mockSupabaseOrganizations.single
        .mockResolvedValueOnce({ data: mockOrganization, error: null })
        .mockResolvedValueOnce({
          data: { ...mockOrganization, name: 'Updated Name' },
          error: null,
        });

      const result = await service.update({
        id: mockOrganization.id,
        name: 'Updated Name',
      });

      expect(result.name).toBe('Updated Name');
    });

    it('should throw NotFoundException for non-existent organization', async () => {
      mockSupabaseOrganizations.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Not found' },
      });

      await expect(
        service.update({ id: 'non-existent', name: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should delete organization', async () => {
      // First call to single() is for findOne
      mockSupabaseOrganizations.single.mockResolvedValueOnce({
        data: mockOrganization,
        error: null,
      });
      // After findOne succeeds, delete().eq() should resolve
      // We need to make the final eq() in the delete chain resolve
      mockSupabaseOrganizations.eq
        .mockReturnValueOnce(mockSupabaseOrganizations) // for select().eq()
        .mockResolvedValueOnce({ error: null }); // for delete().eq()

      await expect(service.remove(mockOrganization.id)).resolves.not.toThrow();
    });

    it('should throw NotFoundException for non-existent organization', async () => {
      mockSupabaseOrganizations.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Not found' },
      });

      await expect(service.remove('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
