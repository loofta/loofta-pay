import { TelegramWalletService } from './telegram-wallet.service';
import { UncertainPaymentError } from '../twitter-autopay/twitter-autopay.service';

const OWN = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const FEE_PAYER = '5dCTWJj277c41ex92RFxSRUa8ckU4EAurWftDRASBKuq';
const OTHER = '4SD8CCJFazZX6JjJffmTvNxPkmpT8MApeGj4QDpSMxsX';

function build(o: { hasAccount?: boolean; accountCheckThrows?: boolean; sendError?: Error; rangeKey?: string } = {}) {
  const calls = { sent: [] as any[] };
  const signer: any = {
    isAvailable: true,
    feePayerAddress: FEE_PAYER,
    usdcAccountExists: async () => {
      if (o.accountCheckThrows) throw new Error('rpc down');
      return o.hasAccount ?? true;
    },
    resolveSenderWallet: async () => ({ address: OWN, walletId: 'w1' }),
    signAndSendTransfer: jest.fn(async (p: any) => {
      calls.sent.push(p);
      if (o.sendError) throw o.sendError;
      return { signature: 'SIG1' };
    }),
  };
  const users: any = { getSolanaWalletAddress: async () => OWN };
  const config: any = { get: (k: string) => (k === 'RANGE_API_KEY' ? o.rangeKey : undefined) };
  return { svc: new TelegramWalletService(config, users, {} as any, signer, {} as any), calls, signer };
}

describe('checkSolanaDestination', () => {
  it('accepts a real wallet that already has a USDC account', async () => {
    expect(await build().svc.checkSolanaDestination('u', OTHER)).toEqual({ ok: true });
  });
  it('refuses text that is not an address', async () => {
    expect(await build().svc.checkSolanaDestination('u', 'hello')).toMatchObject({ ok: false });
  });
  it('refuses the persons own wallet and the Loofta fee account', async () => {
    expect(await build().svc.checkSolanaDestination('u', OWN)).toMatchObject({ ok: false, reason: expect.stringContaining('own') });
    expect(await build().svc.checkSolanaDestination('u', FEE_PAYER)).toMatchObject({ ok: false });
  });
  it('refuses a wallet with no USDC account instead of creating one for a stranger', async () => {
    const r = await build({ hasAccount: false }).svc.checkSolanaDestination('u', OTHER);
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('no USDC account') });
  });
  it('refuses, asking to retry, when the account check itself fails', async () => {
    expect(await build({ accountCheckThrows: true }).svc.checkSolanaDestination('u', OTHER)).toMatchObject({ ok: false, reason: expect.stringContaining('try again') });
  });
  describe('address screening', () => {
    const realFetch = global.fetch;
    afterEach(() => { global.fetch = realFetch; });
    it('refuses an address Range marks malicious', async () => {
      global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ malicious: true }) })) as any;
      expect(await build({ rangeKey: 'k' }).svc.checkSolanaDestination('u', OTHER)).toMatchObject({ ok: false, reason: expect.stringContaining('risky') });
    });
    it('carries on when screening is down, as the app does', async () => {
      global.fetch = jest.fn(async () => { throw new Error('timeout'); }) as any;
      expect(await build({ rangeKey: 'k' }).svc.checkSolanaDestination('u', OTHER)).toEqual({ ok: true });
    });
  });
});

describe('executeSolanaWithdrawal', () => {
  it('sends USDC and never lets the sponsor create the destination account', async () => {
    const { svc, calls } = build();
    expect(await svc.executeSolanaWithdrawal({ userId: 'u', destination: OTHER, amountUsd: 12.5 })).toEqual({ signature: 'SIG1' });
    expect(calls.sent[0]).toMatchObject({ destinationAddress: OTHER, amountUsd: 12.5, forbidAtaCreation: true });
  });
  it('refuses a bad address or amount before touching the wallet', async () => {
    const { svc, signer } = build();
    await expect(svc.executeSolanaWithdrawal({ userId: 'u', destination: 'nope', amountUsd: 5 })).rejects.toThrow();
    await expect(svc.executeSolanaWithdrawal({ userId: 'u', destination: OTHER, amountUsd: 0 })).rejects.toThrow();
    expect(signer.signAndSendTransfer).not.toHaveBeenCalled();
  });
  it('reports a transaction it could not see land as uncertain, never as "nothing was sent"', async () => {
    const { svc } = build({ sendError: new Error('Sponsored transaction not observed on RPC within 90000ms (signature ' + 'a'.repeat(88) + ').') });
    await expect(svc.executeSolanaWithdrawal({ userId: 'u', destination: OTHER, amountUsd: 5 })).rejects.toBeInstanceOf(UncertainPaymentError);
  });
  it('passes a definite refusal through as an ordinary error', async () => {
    const { svc } = build({ sendError: new Error('RPC request denied due to policy violation') });
    const err = await svc.executeSolanaWithdrawal({ userId: 'u', destination: OTHER, amountUsd: 5 }).catch((e) => e);
    expect(err).not.toBeInstanceOf(UncertainPaymentError);
  });
});

describe('other crypto through NEAR Intents', () => {
  const tok = (symbol: string, chain: string, tokenId = `nep141:${symbol.toLowerCase()}-${chain}.omft.near`) => ({ symbol, name: symbol, chain, address: '', tokenId, decimals: 6 });
  const ALL = [tok('USDC', 'solana'), tok('USDC', 'base'), tok('ARB', 'arbitrum'), tok('USDT', 'tron'), tok('USDT', 'eth'), tok('USDT', 'eth', 'nep245:bridge-usdt')];
  function buildNear(o: { memo?: string | null; out?: string } = {}) {
    const created: any[] = [];
    const near: any = {
      getTokens: async () => ALL,
      findToken: async (sym: string, chains: string[]) => ALL.find((t) => t.symbol === sym && chains.includes(t.chain)),
      getDryQuote: jest.fn(async () => ({ amountOut: o.out ?? '9.97' })),
      createWithdrawalOrder: jest.fn(async (p: any) => {
        created.push(p);
        return { id: 'order-1', depositAddress: 'DEPOSIT', memo: o.memo ?? null, amountOutFormatted: o.out ?? '9.97' };
      }),
    };
    const signer: any = {
      isAvailable: true,
      feePayerAddress: FEE_PAYER,
      resolveSenderWallet: async () => ({ address: OWN, walletId: 'w1' }),
      signAndSendTransfer: jest.fn(async () => ({ signature: 'SIG9' })),
    };
    const users: any = { getSolanaWalletAddress: async () => OWN };
    return { svc: new TelegramWalletService({ get: () => undefined } as any, users, {} as any, signer, near), near, signer, created };
  }

  it('finds a token on a named network, and lists the networks when none is named', async () => {
    const { svc } = buildNear();
    expect((await svc.resolveToken('ARB', 'arbitrum')).token).toMatchObject({ symbol: 'ARB', chain: 'arbitrum' });
    expect((await svc.resolveToken('ARB')).token?.chain).toBe('arbitrum');
    const usdt = await svc.resolveToken('USDT');
    expect(usdt.options?.map((o) => o.chain).sort()).toEqual(['eth', 'tron']);
  });
  it('prefers the ordinary token over a bridged multi-token, and never offers USDC on Solana as "other"', async () => {
    const { svc } = buildNear();
    expect((await svc.resolveToken('USDT', 'eth')).token?.tokenId).toBe('nep141:usdt-eth.omft.near');
    expect(await svc.resolveToken('USDC', 'solana')).toEqual({});
  });
  it('says nothing is found instead of guessing', async () => {
    expect(await buildNear().svc.resolveToken('NOPE')).toEqual({});
  });

  it('quotes with the real destination and the persons own wallet as refund', async () => {
    const { svc, near } = buildNear();
    const r = await svc.quoteWithdrawal({ userId: 'u', token: { symbol: 'USDC', chain: 'base', tokenId: 't', decimals: 6 }, amountUsd: 10, destination: '0x' + 'a'.repeat(40) });
    expect(r.out).toBeCloseTo(9.97);
    expect(near.getDryQuote).toHaveBeenCalledWith(expect.objectContaining({ recipient: '0x' + 'a'.repeat(40), refundTo: OWN }));
  });

  it('creates the backend order first, with the persons wallet as the refund address', async () => {
    const { svc, created } = buildNear();
    const o = await svc.createNearWithdrawal({ userId: 'u', token: { symbol: 'USDC', chain: 'base', tokenId: 't', decimals: 6 }, amountUsd: 10, destination: '0x' + 'a'.repeat(40) });
    expect(o.id).toBe('order-1');
    expect(o.out).toBeCloseTo(9.97);
    expect(created[0]).toMatchObject({ userId: 'u', refundAddress: OWN, amountUsdc: '10' });
  });
  it('refuses a destination in the wrong format for the network, before any order exists', async () => {
    const { svc, near } = buildNear();
    await expect(svc.createNearWithdrawal({ userId: 'u', token: { symbol: 'USDC', chain: 'base', tokenId: 't', decimals: 6 }, amountUsd: 10, destination: OWN })).rejects.toThrow();
    expect(near.createWithdrawalOrder).not.toHaveBeenCalled();
  });

  it('pays into the order with its id, so the sponsor can bind to it', async () => {
    const { svc, signer } = buildNear();
    await svc.payNearOrder({ userId: 'u', order: { id: 'order-1', depositAddress: 'DEPOSIT', memo: null }, amountUsd: 10 });
    expect(signer.signAndSendTransfer).toHaveBeenCalledWith(expect.objectContaining({ destinationAddress: 'DEPOSIT', nearIntentsOrderId: 'order-1', amountUsd: 10 }));
  });
  it('refuses a deposit that needs a memo instead of sending it without one', async () => {
    const { svc, signer } = buildNear();
    await expect(svc.payNearOrder({ userId: 'u', order: { id: 'order-1', depositAddress: 'DEPOSIT', memo: 'abc' }, amountUsd: 10 })).rejects.toThrow(/memo/);
    expect(signer.signAndSendTransfer).not.toHaveBeenCalled();
  });
  it('an unconfirmed broadcast stays uncertain', async () => {
    const { svc, signer } = buildNear();
    signer.signAndSendTransfer.mockRejectedValueOnce(new Error('fetch failed'));
    await expect(svc.payNearOrder({ userId: 'u', order: { id: 'order-1', depositAddress: 'DEPOSIT', memo: null }, amountUsd: 10 })).rejects.toBeInstanceOf(UncertainPaymentError);
  });
});
