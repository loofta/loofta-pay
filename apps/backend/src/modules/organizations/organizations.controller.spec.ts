import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto, CheckoutStatus } from './dto';
import { AdminGuard } from '@/common/guards';

describe('OrganizationsController', () => {
  let controller: OrganizationsController;
  let service: OrganizationsService;

  const mockOrganization = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    organization_id: 'acme-corp',
    name: 'Acme Corporation',
    logo_url: 'https://example.com/logo.png',
    checkout_status: 'active' as const,
    org_referral: 'org_abc123xyz789def0',
    recipient_wallet: '0x1234...abcd',
    token_symbol: 'USDC',
    token_chain: 'base',
    bg_color: '#1a1a1a',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: null,
  };

  const mockOrganizationsService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    findByReferral: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  // Mock guard that always allows access
  const mockAdminGuard = {
    canActivate: jest.fn((context: ExecutionContext) => true),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrganizationsController],
      providers: [
        {
          provide: OrganizationsService,
          useValue: mockOrganizationsService,
        },
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue(mockAdminGuard)
      .compile();

    controller = module.get<OrganizationsController>(OrganizationsController);
    service = module.get<OrganizationsService>(OrganizationsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all organizations', async () => {
      mockOrganizationsService.findAll.mockResolvedValue([mockOrganization]);

      const result = await controller.findAll();

      expect(result.organizations).toHaveLength(1);
      expect(result.organizations[0].organization_id).toBe('acme-corp');
      expect(service.findAll).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return organization by ID', async () => {
      mockOrganizationsService.findOne.mockResolvedValue(mockOrganization);

      const result = await controller.findOne(mockOrganization.id);

      expect(result.organization.organization_id).toBe('acme-corp');
      expect(service.findOne).toHaveBeenCalledWith(mockOrganization.id);
    });
  });

  describe('getPublicByReferral', () => {
    it('should return public organization info', async () => {
      mockOrganizationsService.findByReferral.mockResolvedValue(mockOrganization);

      const result = await controller.getPublicByReferral('org_abc123xyz789def0');

      expect(result.name).toBe('Acme Corporation');
      expect(result.logo_url).toBe('https://example.com/logo.png');
      expect(result.bg_color).toBe('#1a1a1a');
      expect(service.findByReferral).toHaveBeenCalledWith('org_abc123xyz789def0');
    });

    it('should throw error when organization not found', async () => {
      mockOrganizationsService.findByReferral.mockResolvedValue(null);

      await expect(
        controller.getPublicByReferral('invalid-code'),
      ).rejects.toThrow('Organization not found');
    });
  });

  describe('create', () => {
    const createDto: CreateOrganizationDto = {
      organization_id: 'new-org',
      name: 'New Organization',
      checkout_status: CheckoutStatus.ACTIVE,
    };

    it('should create organization', async () => {
      mockOrganizationsService.create.mockResolvedValue({
        ...mockOrganization,
        ...createDto,
      });

      const result = await controller.create(createDto);

      expect(result.organization.organization_id).toBe('new-org');
      expect(service.create).toHaveBeenCalledWith(createDto);
    });
  });

  describe('update', () => {
    it('should update organization', async () => {
      const updateDto = { id: mockOrganization.id, name: 'Updated Name' };
      mockOrganizationsService.update.mockResolvedValue({
        ...mockOrganization,
        name: 'Updated Name',
      });

      const result = await controller.update(updateDto);

      expect(result.organization.name).toBe('Updated Name');
      expect(service.update).toHaveBeenCalledWith(updateDto);
    });
  });

  describe('remove', () => {
    it('should delete organization', async () => {
      mockOrganizationsService.remove.mockResolvedValue(undefined);

      const result = await controller.remove(mockOrganization.id);

      expect(result.success).toBe(true);
      expect(service.remove).toHaveBeenCalledWith(mockOrganization.id);
    });
  });
});
