import { AgentCashoutService } from './agent-cashout.service';
import { AgentPaymentsService } from './agent-payments.service';
import { TestDb } from './test-db';
import type { AgentSession } from './agent-auth.service';

const peer = { cashout: jest.fn(), withdraw: jest.fn() };
jest.mock('@/common/peer-cashout', () => ({
  peerCashout: (...a: any[]) => peer.cashout(...a),
  peerWithdraw: (...a: any[]) => peer.withdraw(...a),
  peerCashoutErrorMessage: (e: any) => e?.message ?? null,
}));
jest.mock('viem/accounts', () => ({ generatePrivateKey: () => '0x' + '11'.repeat(32) }));
jest.mock('@solana/web3.js', () => ({ ...jest.requireActual('@solana/web3.js'), sendAndConfirmTransaction: jest.fn(async () => 'solsig') }));
jest.mock('@/common/burner-reclaim', () => ({ reclaimBurnerFunds: jest.fn(async () => ({})) }));

const SOL = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const session = (over: Partial<AgentSession> = {}): AgentSession => ({
  id: 'sess-1', userId: 'did:privy:u', label: 'Claude', scopes: ['read', 'pay'], perPaymentCapUsd: 100, dailyCapUsd: 500, autoApproveUsd: 5,
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(), ...over,
});

function build(o: { burnerBalance?: bigint; relayStatus?: string; depositBalance?: bigint; offrampStatus?: string; allowNew?: boolean } = {}) {
  const db = new TestDb();
  const offramp: any = {
    createAgentRecord: jest.fn(async () => ({ id: 'off-1', shortId: 'abc12345' })),
    recordDeposit: jest.fn(async () => ({ status: 'DEPOSITED' })),
    getStatus: jest.fn(async () => ({ status: o.offrampStatus ?? 'DEPOSITED', fill_state: 'awaiting-buyer', filled_amount_usdc: 0 })),
    updateStatus: jest.fn(async () => undefined),
  };
  const relay: any = {
    getSolToBaseQuote: jest.fn(async ({ outputUnits }: any) => ({ requestId: 'rq1', requiredInputUnits: outputUnits + 20_000n, instructions: [], addressLookupTableAddresses: [] })),
    executeSolanaQuote: jest.fn(async () => 'bridgesig'),
    getStatus: jest.fn(async () => (o.relayStatus ?? 'DONE')),
  };
  const near: any = { getDefuseAssetId: async () => 'tok', getDepositQuote: jest.fn(async () => ({ depositAddress: '0x1111111111111111111111111111111111111111' })) };
  const users: any = {
    getSolanaWalletAddress: async () => SOL,
    getSolanaWalletBalanceAndAddress: async () => ({ balanceUSD: 100, walletAddress: SOL }),
  };
  const kpSecret = require('@solana/web3.js').Keypair.generate().secretKey;
  const enc: any = { encrypt: () => 'v2:enc', decrypt: () => Buffer.from(kpSecret) };
  const signer: any = { isAvailable: true, resolveSenderWallet: async () => ({ address: SOL, walletId: 'w1' }), signAndSendTransfer: jest.fn(async () => ({ signature: 'usersig' })) };
  const notifier: any = { notifyUser: jest.fn(async () => true), registerApprovalHandler: jest.fn() };
  const config: any = { get: (k: string, d?: any) => (k === 'NODE_ENV' ? 'production' : d) };
  const rhinestone: any = { getCompanionAddress: jest.fn(async () => '0xAbCdEf0000000000000000000000000000000001'), sendSponsored: jest.fn(async () => '0xhash') };
  const cash = new AgentCashoutService(db as any, config, offramp, relay, rhinestone, near, users, enc, signer, notifier);
  // the Base side is faked at the viem boundary
  const wallet = {};
  (cash as any).clients = async () => ({ key: '0x11', account: { address: '0xAbCdEf0000000000000000000000000000000001' }, publicClient: { getBalance: async () => 0n, estimateFeesPerGas: async () => ({ maxFeePerGas: 1n }) }, wallet });
  (cash as any).usdcBalance = async () => o.depositBalance ?? 30_000_000n;
  (cash as any).burnerUsdc = async () => o.burnerBalance ?? 40_000_000n;
  (cash as any).feePayerKeypair = async () => require('@solana/web3.js').Keypair.generate();
  (cash as any).solKeypair = () => require('@solana/web3.js').Keypair.fromSecretKey(kpSecret);
  const settleSpy = jest.spyOn(cash as any, 'settleBurner').mockResolvedValue(undefined);
  jest.spyOn(cash as any, 'reclaim').mockResolvedValue(undefined);
  const autopay: any = { resolvePayerByUserId: async () => ({ signerGranted: true }), assertWithinLimits: jest.fn(async () => undefined) };
  const payments = new AgentPaymentsService(db as any, { get: () => undefined } as any, users, autopay, notifier, cash);
  return { cash, payments, db, offramp, relay, near, wallet, notifier, rhinestone, signer, settleSpy };
}

beforeEach(() => { peer.cashout.mockReset(); peer.withdraw.mockReset(); });

const REQ = { platform: 'revolut', handle: '@lisa1wyj', amount_usd: 20 };

describe('quoting a cash-out', () => {
  it('shows what they receive and the total from the wallet', async () => {
    const { payments } = build();
    const q: any = await payments.cashQuote(session(), REQ);
    expect(q).toMatchObject({ recipient: 'Revolut @lisa1wyj', they_receive_usd: 20, needs_approval: true });
    expect(q.total_from_wallet_usd).toBeGreaterThan(20.4);
    expect(q.total_from_wallet_usd).toBeLessThan(21.5);
  });
  it('refuses a platform or handle it cannot pay', async () => {
    const { payments } = build();
    await expect(payments.cashQuote(session(), { ...REQ, platform: 'paypal' })).rejects.toMatchObject({ response: { code: 'unknown_platform' } });
    await expect(payments.cashQuote(session(), { ...REQ, handle: 'a b' })).rejects.toMatchObject({ response: { code: 'bad_handle' } });
    await expect(payments.cashQuote(session(), { ...REQ, amount_usd: 0.5 })).rejects.toMatchObject({ response: { code: 'bad_amount' } });
    await expect(payments.cashQuote(session(), { ...REQ, amount_usd: 1500 })).rejects.toMatchObject({ response: { code: 'bad_amount' } });
  });
});

describe('asking to cash out', () => {
  it('waits for approval when the handle is new, and starts nothing', async () => {
    const { payments, offramp } = build();
    const r: any = await payments.cashPay(session(), REQ, 'key-12345678');
    expect(r.status).toBe('needs_approval');
    expect(r.recipients[0]).toMatchObject({ recipient: 'Revolut @lisa1wyj', amount_usd: 20, delivery: 'cash' });
    expect(offramp.createAgentRecord).not.toHaveBeenCalled();
  });
  it('a retry with the same key never starts a second one', async () => {
    const { payments } = build();
    const a: any = await payments.cashPay(session(), REQ, 'same-key-1');
    const b: any = await payments.cashPay(session(), REQ, 'same-key-1');
    expect(b.id).toBe(a.id);
  });
  it('approving moves the USDC to a backend burner, which then bridges it with Relay to a Rhinestone Base account', async () => {
    const { payments, signer, db, relay } = build();
    const a: any = await payments.cashPay(session(), REQ, 'key-approve-1');
    const r: any = await payments.approve('did:privy:u', a.id);
    expect(r.status).toBe('processing');
    expect(r.links).toMatchObject({ receipt_url: expect.stringContaining('/app/pay/abc12345'), share_url: expect.stringContaining('/share/abc12345') });
    // the only thing the person's key signs is a plain USDC transfer to the burner (no account creation)
    expect(signer.signAndSendTransfer).toHaveBeenCalledWith(expect.objectContaining({ forbidAtaCreation: true, senderWalletId: 'w1', isDevnet: false }));
    // the burner is sent a 1% cushion over what Relay asked for
    const sent = signer.signAndSendTransfer.mock.calls[0][0].amountUsd;
    const asked = Number((await relay.getSolToBaseQuote.mock.results[0].value).requiredInputUnits) / 1e6;
    expect(sent).toBeGreaterThan(asked * 1.0099);
    const row = db.rows('agent_cashouts')[0];
    expect(row).toMatchObject({ handle: 'lisa1wyj', base_key_enc: 'v2:enc', sol_key_enc: 'v2:enc', base_address: '0xAbCdEf0000000000000000000000000000000001' });
    await new Promise((res) => setImmediate(res)); // the first bridge attempt runs right after the transfer
    expect(relay.executeSolanaQuote).toHaveBeenCalled();
    expect(row.step).toBe('bridging');
  });
  it('a transfer that does not go through fails the request and moves nothing', async () => {
    const { payments, signer, db } = build({ burnerBalance: 0n });
    signer.signAndSendTransfer.mockRejectedValueOnce(new Error('insufficient funds'));
    const a: any = await payments.cashPay(session(), REQ, 'key-approve-2');
    const r: any = await payments.approve('did:privy:u', a.id);
    expect(r.status).toBe('failed');
    expect(db.rows('agent_cashouts')[0].step).toBe('failed');
  });
  it('a Privy policy block says so', async () => {
    const { payments, signer } = build({ burnerBalance: 0n });
    signer.signAndSendTransfer.mockRejectedValueOnce(new Error('Policy violation: denied'));
    const a: any = await payments.cashPay(session(), REQ, 'key-approve-3');
    const r: any = await payments.approve('did:privy:u', a.id);
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/signing policy/);
  });
});

async function started(o: Parameters<typeof build>[0] = {}) {
  const b = build(o);
  const a: any = await b.payments.cashPay(session(), REQ, 'key-flow-0001');
  await b.payments.approve('did:privy:u', a.id);
  return { ...b, actionId: a.id, row: () => b.db.rows('agent_cashouts')[0] };
}

describe('following a cash-out', () => {
  it('bridging -> depositing -> open once the USDC is on Base and the deposit is made', async () => {
    peer.cashout.mockResolvedValue({ depositId: '0xesc_1', txHash: '0xt' });
    const { cash, row, offramp, db, actionId, settleSpy } = await started();
    row().step = 'bridging'; row().relay_request_id = 'rq1';
    await cash.advance(row());
    expect(row().step).toBe('depositing');
    expect(settleSpy).toHaveBeenCalled(); // excess USDC and rent go home
    await cash.advance(row());
    expect(peer.cashout).toHaveBeenCalledWith(expect.objectContaining({ platform: 'revolut', payee: 'lisa1wyj' }));
    expect(offramp.recordDeposit).toHaveBeenCalledWith('off-1', 'did:privy:u', '0xesc_1', '0xt', null);
    expect(row()).toMatchObject({ step: 'open', deposit_id: '0xesc_1' });
    expect(db.rows('agent_actions').find((r) => r.id === actionId)?.payload.links.peer_deposit_url).toBe('https://app.peer.xyz/deposit/0xesc/1');
  });
  it('waits while the USDC has not shown up on Base yet', async () => {
    const { cash, row } = await started({ depositBalance: 0n });
    row().step = 'depositing';
    await cash.advance(row());
    expect(peer.cashout).not.toHaveBeenCalled();
    expect(row().step).toBe('depositing');
  });
  it('finishes the request and tells the person when the order is delivered', async () => {
    const { cash, row, db, actionId, notifier } = await started({ offrampStatus: 'COMPLETE' });
    row().step = 'open';
    await cash.advance(row());
    expect(row().step).toBe('done');
    expect(db.rows('agent_actions').find((r) => r.id === actionId)).toMatchObject({ status: 'paid' });
    expect(notifier.notifyUser).toHaveBeenCalledWith('did:privy:u', expect.stringContaining('was paid $20.00'));
  });
  it('a handle the curator rejects goes straight to a refund, never retried', async () => {
    peer.cashout.mockRejectedValue(new Error('Revolut username not found: nobody'));
    const { cash, row } = await started();
    row().step = 'depositing';
    await cash.advance(row());
    expect(row().step).toBe('refunding');
  });
  it('refunding with the USDC on Base bridges it home and ends the request as failed', async () => {
    const { cash, row, near, rhinestone, db, actionId } = await started();
    Object.assign(row(), { step: 'refunding', deposit_id: null, error: 'Revolut username not found: nobody' });
    await cash.advance(row());
    expect(near.getDepositQuote).toHaveBeenCalledWith(expect.objectContaining({ recipient: SOL, refundAddress: '0xAbCdEf0000000000000000000000000000000001' }));
    expect(rhinestone.sendSponsored).toHaveBeenCalled();
    expect(row().step).toBe('refunded');
    expect(db.rows('agent_actions').find((r) => r.id === actionId)).toMatchObject({ status: 'failed' });
  });
  it('a failed bridge returns what came back to the burner to the person', async () => {
    const { cash, row, db, actionId } = await started({ relayStatus: 'FAILED' });
    row().step = 'bridging'; row().relay_request_id = 'rq1';
    await cash.advance(row());
    expect(row().step).toBe('returning');
    await cash.advance(row());
    expect(row().step).toBe('failed');
    expect(db.rows('agent_actions').find((r) => r.id === actionId)).toMatchObject({ status: 'failed' });
  });
  it('a cash-out stuck mid-creation is stopped, never retried (it could deposit twice)', async () => {
    const { cash, row } = await started();
    Object.assign(row(), { step: 'creating', updated_at: new Date(Date.now() - 3_600_000).toISOString() });
    await cash.advance(row());
    expect(row().step).toBe('failed');
    expect(peer.cashout).not.toHaveBeenCalled();
  });
});

describe('cancelling (the app\'s Cancel button or the agent)', () => {
  it('an open order goes to refunding and the app is told it is cancelled', async () => {
    const { cash, row, offramp } = await started();
    row().step = 'open';
    const r = await cash.cancelByOfframp('off-1', 'did:privy:u');
    expect(r.status).toBe('CANCELLED');
    expect(row()).toMatchObject({ step: 'refunding', error: 'Cancelled by you.' });
    expect(offramp.updateStatus).toHaveBeenCalledWith('off-1', 'CANCELLING');
  });
  it('cannot cancel once a buyer has paid or locked it, or while bridging', async () => {
    const a = await started();
    a.row().step = 'open';
    a.offramp.getStatus.mockResolvedValueOnce({ status: 'DEPOSITED', fill_state: 'delivering', filled_amount_usdc: 5 });
    await expect(a.cash.cancelByOfframp('off-1', 'did:privy:u')).rejects.toThrow(/already paid/);
    const b = await started();
    await expect(b.cash.cancelByOfframp('off-1', 'did:privy:u')).rejects.toThrow(/moving between networks/);
  });
  it('a finished cancel marks the history entry cancelled and tells the person', async () => {
    const { cash, row, offramp, db, actionId } = await started();
    Object.assign(row(), { step: 'refunding', deposit_id: null, error: 'Cancelled by you.' });
    await cash.advance(row());
    expect(offramp.updateStatus).toHaveBeenCalledWith('off-1', 'CANCELLED', expect.any(String));
    expect(db.rows('agent_actions').find((r) => r.id === actionId)).toMatchObject({ status: 'failed' });
  });
});
