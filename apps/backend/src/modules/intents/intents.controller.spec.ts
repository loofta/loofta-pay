import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetQuoteDto, CreateWithdrawalOrderDto } from './intents.controller';

/**
 * Mirrors the global ValidationPipe options in src/main.ts. When these DTOs had no
 * class-validator decorators, whitelist+forbidNonWhitelisted rejected every declared
 * field as "should not exist", 400ing POST /intents/quote and /intents/withdraw/prepare
 * before the handler ever ran — this broke NEAR Intents cross-chain withdrawals.
 */
const VALIDATION_OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

describe('GetQuoteDto validation', () => {
  const validPayload = {
    fromTokenId: 'nep141:usdc.near',
    fromChain: 'near',
    fromDecimals: 6,
    toTokenId: 'nep141:eth.near',
    toChain: 'eth',
    toDecimals: 18,
    amount: '1000000',
    slippageBps: 100,
  };

  it('accepts a fully-populated valid body', async () => {
    const dto = plainToInstance(GetQuoteDto, validPayload);
    const errors = await validate(dto, VALIDATION_OPTIONS);
    expect(errors).toHaveLength(0);
  });

  it('accepts a valid body without the optional slippageBps', async () => {
    const { slippageBps, ...rest } = validPayload;
    const dto = plainToInstance(GetQuoteDto, rest);
    const errors = await validate(dto, VALIDATION_OPTIONS);
    expect(errors).toHaveLength(0);
  });

  it('rejects an unrecognized property', async () => {
    const dto = plainToInstance(GetQuoteDto, { ...validPayload, notAField: 'x' });
    const errors = await validate(dto, VALIDATION_OPTIONS);
    expect(errors.some((e) => e.property === 'notAField')).toBe(true);
  });

  it('rejects a missing required field', async () => {
    const { fromTokenId, ...rest } = validPayload;
    const dto = plainToInstance(GetQuoteDto, rest);
    const errors = await validate(dto, VALIDATION_OPTIONS);
    expect(errors.some((e) => e.property === 'fromTokenId')).toBe(true);
  });
});

describe('CreateWithdrawalOrderDto validation', () => {
  const validPayload = {
    fromTokenId: 'nep141:usdc.near',
    fromChain: 'solana',
    fromSymbol: 'USDC',
    fromDecimals: 6,
    toTokenId: 'nep141:arb.near',
    toChain: 'arbitrum',
    toSymbol: 'USDC',
    toDecimals: 6,
    amountUsdc: '10.00',
    destinationAddress: '0x1234567890abcdef1234567890abcdef12345678',
    refundAddress: 'So11111111111111111111111111111111111111',
    isDevnet: false,
  };

  it('accepts a fully-populated valid body (regression: this used to 400 with "should not exist")', async () => {
    const dto = plainToInstance(CreateWithdrawalOrderDto, validPayload);
    const errors = await validate(dto, VALIDATION_OPTIONS);
    expect(errors).toHaveLength(0);
  });

  it('accepts a valid body without the optional isDevnet', async () => {
    const { isDevnet, ...rest } = validPayload;
    const dto = plainToInstance(CreateWithdrawalOrderDto, rest);
    const errors = await validate(dto, VALIDATION_OPTIONS);
    expect(errors).toHaveLength(0);
  });

  it('rejects an unrecognized property', async () => {
    const dto = plainToInstance(CreateWithdrawalOrderDto, { ...validPayload, tokenId: 'unexpected' });
    const errors = await validate(dto, VALIDATION_OPTIONS);
    expect(errors.some((e) => e.property === 'tokenId')).toBe(true);
  });

  it('rejects a missing required field', async () => {
    const { destinationAddress, ...rest } = validPayload;
    const dto = plainToInstance(CreateWithdrawalOrderDto, rest);
    const errors = await validate(dto, VALIDATION_OPTIONS);
    expect(errors.some((e) => e.property === 'destinationAddress')).toBe(true);
  });
});
