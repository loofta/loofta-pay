import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LotteryService } from './lottery.service';

describe('LotteryService', () => {
  let service: LotteryService;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      if (key === 'TICKET_AUTOMATOR_ADDRESS') {
        return '0xd1950a138328b52da4fe73dbdb167a83f2c83db9';
      }
      return defaultValue;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LotteryService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<LotteryService>(LotteryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getContractAddress', () => {
    it('should return the ticket automator address', () => {
      const address = service.getContractAddress();
      expect(address).toBe('0xd1950a138328b52da4fe73dbdb167a83f2c83db9');
    });
  });

  describe('encodeTicketPurchase', () => {
    it('should encode calldata correctly', () => {
      const recipientAddress = '0x1234567890abcdef1234567890abcdef12345678';
      const calldata = service.encodeTicketPurchase(recipientAddress);

      // Should start with the function selector
      expect(calldata).toMatch(/^0x/);
      expect(calldata.length).toBeGreaterThan(10);

      // Should contain the recipient address (without 0x, lowercase)
      expect(calldata.toLowerCase()).toContain(
        recipientAddress.slice(2).toLowerCase(),
      );
    });

    it('should produce consistent calldata for same inputs', () => {
      const recipientAddress = '0x1234567890abcdef1234567890abcdef12345678';
      const calldata1 = service.encodeTicketPurchase(recipientAddress);
      const calldata2 = service.encodeTicketPurchase(recipientAddress);

      expect(calldata1).toBe(calldata2);
    });
  });

  describe('estimateTickets', () => {
    it('should estimate tickets correctly', () => {
      const ethAmount = 0.05; // Should get ~100 tickets
      const tickets = service.estimateTickets(ethAmount);

      expect(tickets).toBe(100);
    });

    it('should return 0 for very small amounts', () => {
      const ethAmount = 0.0001;
      const tickets = service.estimateTickets(ethAmount);

      expect(tickets).toBe(0);
    });

    it('should handle large amounts', () => {
      const ethAmount = 1.0; // Should get ~2000 tickets
      const tickets = service.estimateTickets(ethAmount);

      expect(tickets).toBe(2000);
    });
  });

  describe('calculateEthNeeded', () => {
    it('should calculate ETH needed correctly', () => {
      const numTickets = 100;
      const ethNeeded = service.calculateEthNeeded(numTickets);

      // 100 * 0.0005 * 1.05 = 0.0525
      expect(ethNeeded).toBeCloseTo(0.0525, 4);
    });

    it('should include buffer for gas', () => {
      const numTickets = 100;
      const basePrice = 100 * 0.0005;
      const ethNeeded = service.calculateEthNeeded(numTickets);

      expect(ethNeeded).toBeGreaterThan(basePrice);
    });
  });

  describe('validateRecipientAddress', () => {
    it('should validate correct Ethereum address', () => {
      const result = service.validateRecipientAddress(
        '0x1234567890abcdef1234567890abcdef12345678',
      );
      expect(result.valid).toBe(true);
    });

    it('should reject empty address', () => {
      const result = service.validateRecipientAddress('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should reject invalid address format', () => {
      const result = service.validateRecipientAddress('invalid-address');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid');
    });

    it('should reject address without 0x prefix', () => {
      const result = service.validateRecipientAddress(
        '1234567890abcdef1234567890abcdef12345678',
      );
      expect(result.valid).toBe(false);
    });

    it('should reject address with wrong length', () => {
      const result = service.validateRecipientAddress('0x1234');
      expect(result.valid).toBe(false);
    });
  });

  describe('getContractInfo', () => {
    it('should return contract information', () => {
      const info = service.getContractInfo();

      expect(info.address).toBe('0xd1950a138328b52da4fe73dbdb167a83f2c83db9');
      expect(info.chain).toBe('base');
      expect(info.chainId).toBe(8453);
      expect(info.abi).toBeDefined();
      expect(info.referralCode).toMatch(/^0x/);
    });
  });
});
