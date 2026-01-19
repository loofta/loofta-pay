import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NearIntentsService } from './near-intents.service';

// Mock the OneClick SDK
jest.mock('@defuse-protocol/one-click-sdk-typescript', () => ({
  OneClickService: {
    getTokens: jest.fn(),
    getQuote: jest.fn(),
    getExecutionStatus: jest.fn(),
  },
  QuoteRequest: {
    swapType: { EXACT_INPUT: 'EXACT_INPUT', EXACT_OUTPUT: 'EXACT_OUTPUT' },
    depositType: { ORIGIN_CHAIN: 'ORIGIN_CHAIN', INTENTS: 'INTENTS' },
    refundType: { ORIGIN_CHAIN: 'ORIGIN_CHAIN', INTENTS: 'INTENTS' },
    recipientType: { ORIGIN_CHAIN: 'ORIGIN_CHAIN', DESTINATION_CHAIN: 'DESTINATION_CHAIN', INTENTS: 'INTENTS' },
  },
  OpenAPI: {
    BASE: '',
    TOKEN: '',
  },
}));

import { OneClickService } from '@defuse-protocol/one-click-sdk-typescript';

describe('NearIntentsService', () => {
  let service: NearIntentsService;

  const mockTokens = [
    {
      symbol: 'ETH',
      assetId: 'nep141:eth.omft.near',
      blockchain: 'eth',
      decimals: 18,
      price: 3000,
      icon: 'https://example.com/eth.png',
    },
    {
      symbol: 'USDC',
      assetId: 'nep141:usdc.base.omft.near',
      blockchain: 'base',
      decimals: 6,
      price: 1,
      icon: 'https://example.com/usdc.png',
    },
  ];

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      const config: Record<string, string> = {
        ONECLICK_API_BASE: 'https://1click.chaindefuser.com',
        ONECLICK_REFERRAL: 'loofta',
        APP_FEE_BPS: '30',
        APP_FEE_RECIPIENT: '0x1234...',
      };
      return config[key] || defaultValue;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NearIntentsService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<NearIntentsService>(NearIntentsService);
    service.onModuleInit();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getTokens', () => {
    it('should fetch and cache tokens', async () => {
      (OneClickService.getTokens as jest.Mock).mockResolvedValueOnce(mockTokens);

      const tokens = await service.getTokens();

      expect(tokens).toHaveLength(2);
      expect(tokens[0].symbol).toBe('ETH');
      expect(tokens[1].symbol).toBe('USDC');
      expect(OneClickService.getTokens).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const cachedTokens = await service.getTokens();
      expect(cachedTokens).toHaveLength(2);
      expect(OneClickService.getTokens).toHaveBeenCalledTimes(1);
    });

    it('should handle SDK errors gracefully', async () => {
      (OneClickService.getTokens as jest.Mock).mockRejectedValueOnce(
        new Error('Network error'),
      );

      const tokens = await service.getTokens();
      expect(tokens).toEqual([]); // Empty cache
    });
  });

  describe('searchTokens', () => {
    beforeEach(() => {
      (OneClickService.getTokens as jest.Mock).mockResolvedValue(mockTokens);
    });

    it('should filter tokens by symbol', async () => {
      const results = await service.searchTokens('eth');
      expect(results).toHaveLength(1);
      expect(results[0].symbol).toBe('ETH');
    });

    it('should filter tokens by chain', async () => {
      const results = await service.searchTokens('base');
      expect(results).toHaveLength(1);
      expect(results[0].chain).toBe('base');
    });

    it('should return all tokens for empty query', async () => {
      const results = await service.searchTokens('');
      expect(results).toHaveLength(2);
    });
  });

  describe('getDefuseAssetId', () => {
    beforeEach(() => {
      (OneClickService.getTokens as jest.Mock).mockResolvedValue(mockTokens);
    });

    it('should return asset ID from token list', async () => {
      const assetId = await service.getDefuseAssetId('ETH', 'eth');
      expect(assetId).toBe('nep141:eth.omft.near');
    });

    it('should construct fallback asset ID', async () => {
      const assetId = await service.getDefuseAssetId('ETH', 'arbitrum');
      // Should construct fallback since not in token list
      expect(assetId).toContain('nep141:');
    });
  });

  describe('getTokenPrice', () => {
    beforeEach(() => {
      (OneClickService.getTokens as jest.Mock).mockResolvedValue(mockTokens);
    });

    it('should return token price', async () => {
      const price = await service.getTokenPrice('ETH', 'eth');
      expect(price).toBe(3000);
    });

    it('should return undefined for unknown token', async () => {
      const price = await service.getTokenPrice('UNKNOWN', 'unknown');
      expect(price).toBeUndefined();
    });
  });

  describe('getDryQuote', () => {
    it('should return quote with amountOut', async () => {
      (OneClickService.getQuote as jest.Mock).mockResolvedValueOnce({
        quote: {
          amountOut: '1000000000',
          amountOutFormatted: '1000',
        },
      });

      const result = await service.getDryQuote({
        fromToken: { tokenId: 'nep141:eth.omft.near', chain: 'eth', decimals: 18 },
        toToken: { tokenId: 'nep141:usdc.base.omft.near', chain: 'base', decimals: 6 },
        amount: '1',
      });

      expect(result.amountOut).toBe('1000');
      expect(result.error).toBeUndefined();
    });

    it('should return error for failed quote', async () => {
      (OneClickService.getQuote as jest.Mock).mockRejectedValueOnce({
        status: 400,
        message: 'Invalid amount',
      });

      const result = await service.getDryQuote({
        fromToken: { tokenId: 'nep141:eth.omft.near', chain: 'eth', decimals: 18 },
        toToken: { tokenId: 'nep141:usdc.base.omft.near', chain: 'base', decimals: 6 },
        amount: '0',
      });

      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe('client');
    });
  });

  describe('getExecutionStatus', () => {
    it('should return status for deposit address', async () => {
      (OneClickService.getExecutionStatus as jest.Mock).mockResolvedValueOnce({
        status: 'COMPLETED',
        txHash: '0xabc123...',
      });

      const status = await service.getExecutionStatus('0x1234...');

      expect(status.status).toBe('COMPLETED');
      expect(status.txHash).toBe('0xabc123...');
    });

    it('should throw error for missing deposit address', async () => {
      await expect(service.getExecutionStatus('')).rejects.toThrow(
        'Missing depositAddress',
      );
    });
  });

  describe('getRefundAddress', () => {
    it('should return correct refund address for ETH', () => {
      const address = service.getRefundAddress('eth');
      expect(address).toBe('0x0000000000000000000000000000000000000000');
    });

    it('should return correct refund address for Solana', () => {
      const address = service.getRefundAddress('sol');
      expect(address).toBe('11111111111111111111111111111111');
    });

    it('should return correct refund address for NEAR', () => {
      const address = service.getRefundAddress('near');
      expect(address).toBe('system.near');
    });
  });
});
