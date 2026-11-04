import { AgentFundingService, mapNearStatus } from './agent-funding.service';
jest.mock('@/common/magicblock-private-transfer', () => ({ fetchSolPriceUsd: async () => 100 }));
import { TestDb } from './test-db';
import type { AgentSession } from './agent-auth.service';

const SOL_WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const EVM = '0x1111111111111111111111111111111111111111';
const OTHER_EVM = '0x2222222222222222222222222222222222222222';

const session = (over: Partial<AgentSession> = {}): AgentSession => ({
  id: 'sess-1', userId: 'did:privy:u', label: 'Claude', scopes: ['read', 'pay'], perPaymentCapUsd: 25, dailyCapUsd: 100, autoApproveUsd: 5,
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(), ...over,
});

const tok = (symbol: string, chain: string, id = `nep141:${symbol.toLowerCase()}-${chain}.omft.near`) => ({ symbol, chain, tokenId: id, decimals: symbol === 'ETH' ? 18 : 6 });
const TOKENS = [tok('USDC', 'solana'), tok('ETH', 'base'), tok('ETH', 'arb'), tok('BONK', 'solana'), tok('BTC', 'btc'), tok('USDT', 'eth')];

function build(o: { quote?: (p: any) => any; status?: (addr: string) => any; onCron?: boolean } = {}) {
  const db = new TestDb();
  let n = 0;
  const near: any = {
    getTokens: async () => TOKENS,
    findToken: async (sym: string, chains: string[]) => TOKENS.find((t) => t.symbol === sym && chains.includes(t.chain)),
    getDepositQuote: jest.fn(async (p: any) => (o.quote ? o.quote(p) : { depositAddress: `dep-${++n}`, memo: null, deadline: new Date(Date.now() + 3_600_000).toISOString(), amountOutFormatted: '9.5', amountInFormatted: '0.0031', raw: {} })),
    getExecutionStatus: jest.fn(async (addr: string) => (o.status ? o.status(addr) : { status: 'PENDING_DEPOSIT' })),
  };
  const users: any = {
    getSolanaWalletAddress: async () => SOL_WALLET,
    isEvmAddressInLinkedAccounts: async (_u: string, a: string) => a === EVM,
  };
  const notifier: any = { notifyUser: jest.fn(async () => true) };
  const config: any = { get: (k: string) => (k === 'NODE_ENV' ? 'production' : undefined) };
  const tgWallet: any = { startPrivateDeposit: jest.fn(async (_u: string, a: number) => ({ id: 'pd1', depositAddress: 'PrivDep1', amountToSendUsdc: a + 0.3, feeEstimateUsdc: 0.3 })) };
  const solSwap: any = {
    newBurner: jest.fn(() => ({ address: `BurnerSol${++n}`, keyEnc: 'v2:enc' })),
    settle: jest.fn(async () => ({ state: 'waiting' })),
    refund: jest.fn(async () => undefined),
  };
  const svc = new AgentFundingService(db as any, config, near, users, notifier, tgWallet, solSwap);
  return { svc, db, near, notifier, solSwap };
}

const fund = (svc: AgentFundingService, over: any = {}, s = session()) => svc.fund(s, { token: 'ETH', chain: 'base', amount: 0.0031, refund_address: EVM, ...over });

describe('mapNearStatus', () => {
  it.each([
    ['PENDING_DEPOSIT', 'awaiting_deposit'], ['KNOWN_DEPOSIT_TX', 'processing'], ['PROCESSING', 'processing'], ['INCOMPLETE_DEPOSIT', 'incomplete'],
    ['SUCCESS', 'received'], ['REFUNDED', 'refunded'], ['FAILED', 'failed'], ['success', 'received'],
  ])('%s -> %s', (raw, want) => expect(mapNearStatus(raw)).toBe(want));
  it('knows nothing about a status it has not seen', () => expect(mapNearStatus('???')).toBeNull());
});

describe('adding money without questions', () => {
  it('gives the wallet address, card link and other options at once', async () => {
    const { svc } = build();
    const r: any = await svc.options(session());
    expect(r.send_usdc_on_solana_to).toBe(SOL_WALLET);
    expect(r.card_link).toContain('/app?deposit=1');
    expect(r.paying_privately).toMatch(/privately true/);
    expect(r.private_deposit).toBeUndefined();
  });
  it('sets up a private deposit when asked', async () => {
    const { svc } = build();
    const r: any = await svc.options(session(), { private: true, amount_usd: 10 });
    expect(r.private_deposit).toMatchObject({ to_one_time_address: 'PrivDep1', send_exactly_usdc: 10.3, you_receive_usd: 10 });
    await expect(svc.options(session(), { private: true })).rejects.toMatchObject({ response: { code: 'bad_amount' } });
  });
  it('funding with USDC on Solana is just the wallet address', async () => {
    const { svc, near } = build();
    const r: any = await svc.fund(session(), { token: 'USDC', chain: 'solana', receive_usdc: 10 });
    expect(r.send_usdc_on_solana_to).toBe(SOL_WALLET);
    expect(near.getDepositQuote).not.toHaveBeenCalled();
  });
  it('SOL goes to a one-time address and is swapped with Jupiter, never NEAR Intents', async () => {
    const { svc, near, db } = build();
    const r: any = await svc.fund(session(), { token: 'SOL', receive_usdc: 10 });
    expect(r).toMatchObject({ route: 'jupiter', send_to: expect.stringContaining('BurnerSol'), swap_fee: '0.80%', send_amount: '0.111' });
    expect(near.getDepositQuote).not.toHaveBeenCalled();
    expect(db.rows('agent_funding_orders')[0]).toMatchObject({ route: 'jupiter', recipient_address: SOL_WALLET, burner_key_enc: 'v2:enc' });
    const exact: any = await svc.fund(session(), { token: 'SOL', chain: 'solana', amount: 0.5 });
    expect(exact.send_amount).toBe('0.5');
    await expect(svc.fund(session(), { token: 'SOL', amount: 0.001 })).rejects.toMatchObject({ response: { code: 'bad_amount' } });
  });
  it('other Solana tokens are not supported', async () => {
    const { svc } = build();
    await expect(svc.fund(session(), { token: 'BONK', chain: 'solana', amount: 1000 })).rejects.toMatchObject({ response: { code: 'unsupported_token' } });
  });
  it('a SOL order becomes received once the swap is forwarded, and the person is told', async () => {
    const { svc, solSwap, notifier } = build();
    const r: any = await svc.fund(session(), { token: 'SOL', amount: 0.2 });
    solSwap.settle.mockResolvedValueOnce({ state: 'received', usdc: 18.4, signature: 'sigX' });
    const s: any = await svc.status(session(), r.id);
    expect(s).toMatchObject({ status: 'received', received_usdc: 18.4 });
    expect(notifier.notifyUser).toHaveBeenCalled();
  });
  it('an expired SOL order sends anything left back to the person', async () => {
    const { svc, solSwap, db } = build();
    const r: any = await svc.fund(session(), { token: 'SOL', amount: 0.2 });
    db.rows('agent_funding_orders')[0].deadline = new Date(Date.now() - 1000).toISOString();
    const s: any = await svc.status(session(), r.id);
    expect(s.status).toBe('expired');
    expect(solSwap.refund).toHaveBeenCalled();
  });
  it('needs no refund address from Solana, it is the Loofta wallet', async () => {
    const { svc } = build();
    await expect(svc.fund(session(), { token: 'ETH', chain: 'base', amount: 0.01 })).rejects.toMatchObject({ response: { code: 'refund_address_required' } });
  });
});

describe('creating a funding', () => {
  it('asks for a confidential swap into the person\'s own wallet and returns what to send', async () => {
    const { svc, near } = build();
    const r: any = await fund(svc);
    expect(r).toMatchObject({ status: 'awaiting_deposit', token: 'ETH', chain: 'base', confidential: true, confidentiality: 'advanced', expected_usdc: 9.5, refund_address: EVM });
    expect(r.send_to).toBe(r.deposit_address);
    const q = near.getDepositQuote.mock.calls[0][0];
    expect(q.recipient).toBe(SOL_WALLET); // never something the agent chose
    expect(q.confidentiality).toBe('advanced');
    expect(q.toToken.symbol).toBe('USDC');
    expect(r.next).toContain('Send 0.0031 ETH on base');
  });

  it('falls back from advanced to basic, and says which it got', async () => {
    const levels: any[] = [];
    const { svc } = build({ quote: (p) => { levels.push(p.confidentiality); if (p.confidentiality === 'advanced') throw new Error('not supported'); return { depositAddress: 'dep-x', deadline: new Date(Date.now() + 3_600_000).toISOString(), raw: {} }; } });
    const r: any = await fund(svc);
    expect(levels).toEqual(['advanced', 'basic']);
    expect(r.confidentiality).toBe('basic');
  });

  it('refuses to go public on its own, and goes public only when allowed', async () => {
    const onlyPublic = (p: any) => { if (p.confidentiality) throw new Error('no confidential route'); return { depositAddress: 'dep-pub', deadline: new Date(Date.now() + 3_600_000).toISOString(), raw: {} }; };
    const { svc } = build({ quote: onlyPublic });
    await expect(fund(svc)).rejects.toMatchObject({ response: { code: 'confidential_unavailable' } });
    const r: any = await fund(svc, { allow_public: true });
    expect(r).toMatchObject({ confidentiality: 'public', confidential: false });
  });

  it('a public swap can be asked for outright', async () => {
    const { svc, near } = build();
    await fund(svc, { confidential: false });
    expect(near.getDepositQuote.mock.calls[0][0].confidentiality).toBeUndefined();
  });

  it('wants exactly one of amount and receive_usdc, and sensible numbers', async () => {
    const { svc } = build();
    await expect(fund(svc, { amount: undefined })).rejects.toMatchObject({ response: { code: 'bad_amount' } });
    await expect(fund(svc, { receive_usdc: 5 })).rejects.toMatchObject({ response: { code: 'bad_amount' } });
    await expect(fund(svc, { amount: 0 })).rejects.toMatchObject({ response: { code: 'bad_amount' } });
    await expect(fund(svc, { amount: -1 })).rejects.toMatchObject({ response: { code: 'bad_amount' } });
    await expect(fund(svc, { amount: undefined, receive_usdc: 0.5 })).rejects.toMatchObject({ response: { code: 'bad_amount' } });
  });

  it('funds for an amount of USDC to receive too', async () => {
    const { svc, near } = build();
    await fund(svc, { amount: undefined, receive_usdc: 10 });
    const q = near.getDepositQuote.mock.calls[0][0];
    expect(q).toMatchObject({ amountOut: '10', useExactOutput: true });
    expect(q.amountIn).toBeUndefined();
  });

  it('only returns money to a wallet the person owns', async () => {
    const { svc, near } = build();
    await expect(fund(svc, { refund_address: OTHER_EVM })).rejects.toMatchObject({ response: { code: 'refund_address_not_yours' } });
    await expect(fund(svc, { refund_address: 'nope' })).rejects.toMatchObject({ response: { code: 'bad_refund_address' } });
    expect(near.getDepositQuote).not.toHaveBeenCalled();
    const ok: any = await fund(svc, { token: 'USDT', chain: 'eth', refund_address: EVM });
    expect(ok.status).toBe('awaiting_deposit');
  });

  it('does not offer networks it cannot verify a refund for', async () => {
    const { svc } = build();
    await expect(fund(svc, { token: 'BTC', chain: 'btc', refund_address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' })).rejects.toMatchObject({ response: { code: 'unsupported_chain' } });
  });

  it('asks which network when a token lives on several, and rejects unknown tokens', async () => {
    const { svc } = build();
    await expect(fund(svc, { chain: undefined })).rejects.toMatchObject({ response: { code: 'chain_required' } });
    await expect(fund(svc, { token: 'NOPE' })).rejects.toMatchObject({ response: { code: 'unknown_token' } });
  });

  it('needs the pay scope, and limits how many are waiting at once', async () => {
    const { svc } = build();
    await expect(fund(svc, {}, session({ scopes: ['read'] }))).rejects.toMatchObject({ response: { code: 'missing_scope' } });
    for (let i = 0; i < 10; i++) await fund(svc);
    await expect(fund(svc)).rejects.toMatchObject({ response: { code: 'too_many_open' } });
  });
});

describe('following a funding', () => {
  it('keeps saying waiting while nothing arrived, including when NEAR has not seen it yet', async () => {
    const { svc } = build({ status: () => { throw new Error('Deposit address not found'); } });
    const f: any = await fund(svc);
    expect((await svc.status(session(), f.id)).status).toBe('awaiting_deposit');
  });

  it('shows processing, then received with the USDC, and tells the person exactly once', async () => {
    let state: any = { status: 'PROCESSING' };
    const { svc, notifier } = build({ status: () => state });
    const f: any = await fund(svc);
    expect((await svc.status(session(), f.id)).status).toBe('processing');
    expect(notifier.notifyUser).not.toHaveBeenCalled();
    state = { status: 'SUCCESS', swapDetails: { amountOutFormatted: '9.41', destinationChainTxHashes: [{ hash: 'solsig' }] } };
    const done: any = await svc.status(session(), f.id);
    expect(done).toMatchObject({ status: 'received', received_usdc: 9.41, tx_hash: 'solsig' });
    expect(done.next).toContain('You can pay now');
    await svc.status(session(), f.id);
    await svc.followOpenOrders();
    expect(notifier.notifyUser).toHaveBeenCalledTimes(1);
    expect(notifier.notifyUser.mock.calls[0][1]).toContain('9.41 USDC');
    expect(notifier.notifyUser.mock.calls[0][0]).toBe('did:privy:u');
  });

  it('says refunded, and where the money went', async () => {
    const { svc, notifier } = build({ status: () => ({ status: 'REFUNDED', swapDetails: { refundedAmountFormatted: '0.0031', refundTxHashes: [{ hash: 'refundtx' }] } }) });
    const f: any = await fund(svc);
    const r: any = await svc.status(session(), f.id);
    expect(r.status).toBe('refunded');
    expect(r.next).toContain('refunded');
    expect(notifier.notifyUser.mock.calls[0][1]).toContain('refunded');
    expect(notifier.notifyUser.mock.calls[0][1]).toContain(EVM);
  });

  it('reports failed and incomplete deposits', async () => {
    const a = build({ status: () => ({ status: 'FAILED' }) });
    const fa: any = await fund(a.svc);
    expect((await a.svc.status(session(), fa.id)).status).toBe('failed');
    const b = build({ status: () => ({ status: 'INCOMPLETE_DEPOSIT' }) });
    const fb: any = await fund(b.svc);
    expect((await b.svc.status(session(), fb.id)).status).toBe('incomplete');
    expect(b.notifier.notifyUser).not.toHaveBeenCalled(); // not over yet
  });

  it('expires an address nobody paid before its deadline', async () => {
    const { svc, db, notifier } = build();
    const f: any = await fund(svc);
    db.rows('agent_funding_orders')[0].deadline = new Date(Date.now() - 3_600_000).toISOString();
    expect((await svc.status(session(), f.id)).status).toBe('expired');
    expect(notifier.notifyUser.mock.calls[0][1]).toContain('expired');
  });

  it('never lets a session read another sessions funding', async () => {
    const { svc } = build();
    const f: any = await fund(svc);
    await expect(svc.status(session({ id: 'other' }), f.id)).rejects.toThrow(/not found/i);
    expect(await svc.list(session({ id: 'other' }))).toEqual([]);
    expect(await svc.list(session())).toHaveLength(1);
  });

  it('the background follower finishes orders the agent never asked about', async () => {
    let state: any = { status: 'PENDING_DEPOSIT' };
    const { svc, notifier } = build({ status: () => state });
    await fund(svc);
    await svc.followOpenOrders();
    expect(notifier.notifyUser).not.toHaveBeenCalled();
    state = { status: 'SUCCESS', swapDetails: { amountOutFormatted: '9.5' } };
    await svc.followOpenOrders();
    expect(notifier.notifyUser).toHaveBeenCalledTimes(1);
    await svc.followOpenOrders();
    expect(notifier.notifyUser).toHaveBeenCalledTimes(1);
  });

  it('a finished order is never read from NEAR again', async () => {
    const { svc, near } = build({ status: () => ({ status: 'SUCCESS', swapDetails: { amountOutFormatted: '9.5' } }) });
    const f: any = await fund(svc);
    await svc.status(session(), f.id);
    near.getExecutionStatus.mockClear();
    await svc.status(session(), f.id);
    expect(near.getExecutionStatus).not.toHaveBeenCalled();
  });
});
