import { TwitterAutopayService, UncertainPaymentError, isUncertainBroadcastError, signatureFromError } from './twitter-autopay.service';

const SIG = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';

describe('error classification', () => {
  it('treats submit-then-unseen failures as uncertain', () => {
    expect(isUncertainBroadcastError(`Sponsored transaction not observed on RPC within 90000ms (signature ${SIG}).`)).toBe(true);
    expect(isUncertainBroadcastError('fetch failed')).toBe(true);
    expect(isUncertainBroadcastError('Blockhash not found')).toBe(true);
  });
  it('treats refusals and on-chain failures as definite', () => {
    expect(isUncertainBroadcastError('RPC request denied due to policy violation')).toBe(false);
    expect(isUncertainBroadcastError('Simulation failed. insufficient funds')).toBe(false);
    expect(isUncertainBroadcastError('Sponsored transaction failed on-chain: {"InstructionError":[0,{"Custom":1}]}')).toBe(false);
  });
  it('pulls the signature out of the message for the Solscan link', () => {
    expect(signatureFromError(`not observed (signature ${SIG}). Check`)).toBe(SIG);
    expect(signatureFromError('no signature here')).toBeNull();
  });
});

/** executeTelegramAutoPay with every collaborator stubbed, to pin down what happens around the send. */
function build(opts: { sendError?: Error; updateStatusError?: Error }) {
  const calls = { cancelled: [] as string[], sent: 0, updated: 0 };
  const claims: any = {
    createFromSocial: jest.fn(async () => ({ id: 'pay-1', short_id: 'abc12345', link: 'https://x/c/abc12345', burnerAddress: null, payTo: 'DEST', requirePrivate: false })),
    updateStatus: jest.fn(async (id: string, status: string) => {
      if (status === 'CANCELLED') { calls.cancelled.push(id); return; }
      calls.updated++;
      if (opts.updateStatusError) throw opts.updateStatusError;
    }),
    notifyRecipientAfterPayment: jest.fn(),
  };
  const signer: any = {
    isAvailable: true,
    resolveSenderWallet: async () => ({ address: 'SENDER', walletId: 'w1' }),
    usdcAccountExists: async () => true,
    signAndSendTransfer: jest.fn(async () => {
      calls.sent++;
      if (opts.sendError) throw opts.sendError;
      return { signature: 'SIG1' };
    }),
  };
  const users: any = {
    findBySocialHandle: async () => ({ privyUserId: 'did:privy:r' }),
    getSolanaWalletAddress: async () => 'DEST',
  };
  const supabase: any = {
    payments: { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { burner_address: null } }) }) }) },
  };
  const svc = new TwitterAutopayService(supabase, { get: () => undefined } as any, users, claims, signer, {} as any);
  return { svc, calls };
}
const params = { senderUserId: 'did:privy:s', recipientHandle: 'lisabey', amountUsd: 5, isPrivate: false, isDevnet: false };

describe('executeTelegramAutoPay safety', () => {
  it('a bookkeeping failure AFTER the money moved neither fails the payment nor cancels the claim', async () => {
    const { svc, calls } = build({ updateStatusError: new Error('db down') });
    const res = await svc.executeTelegramAutoPay(params);
    expect(res.paymentId).toBe('pay-1');
    expect(calls.sent).toBe(1);
    expect(calls.cancelled).toEqual([]);
  });

  it('an unconfirmed broadcast is reported as uncertain and the claim is NOT cancelled', async () => {
    const { svc, calls } = build({ sendError: new Error(`Sponsored transaction not observed on RPC within 90000ms (signature ${SIG}).`) });
    const err = await svc.executeTelegramAutoPay(params).catch((e) => e);
    expect(err).toBeInstanceOf(UncertainPaymentError);
    expect(err.signature).toBe(SIG);
    expect(calls.cancelled).toEqual([]);
  });

  it('a refusal before anything was sent cancels the claim and is a plain error', async () => {
    const { svc, calls } = build({ sendError: new Error('RPC request denied due to policy violation') });
    const err = await svc.executeTelegramAutoPay(params).catch((e) => e);
    expect(err).not.toBeInstanceOf(UncertainPaymentError);
    expect(calls.cancelled).toEqual(['pay-1']);
  });
});
