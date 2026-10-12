import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  getAccount,
  getAssociatedTokenAddress,
  getMint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { SolanaSponsorService } from '../claims/solana-sponsor.service';

const JUPITER_TOKENS = 'https://api.jup.ag/tokens/v2/search';
const JUPITER_SWAP = 'https://api.jup.ag/swap/v2';
const USDC_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const CLASSIC_TOKEN_PROGRAM = TOKEN_PROGRAM_ID.toBase58();
const TOKEN_2022 = TOKEN_2022_PROGRAM_ID.toBase58();

export interface JupiterTokenHit {
  mint: string;
  symbol: string;
  name: string;
  logo: string | null;
  decimals: number;
  tokenProgram: string;
  usdPrice: number | null;
  verified: boolean;
}

/**
 * Jupiter token search + the USDC→prize swap that lands the chosen token in a giveaway burner.
 * The burner key is one we mint and hold, so topping it up with a little SOL for the swap fee
 * is the "we own it" bucket (recovered later when the burner is reclaimed).
 */
@Injectable()
export class GiveawayTokenService {
  private readonly logger = new Logger(GiveawayTokenService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly solanaSponsor: SolanaSponsorService,
  ) {}

  async search(query: string): Promise<JupiterTokenHit[]> {
    const q = query.trim();
    if (q.length < 2 || q.length > 64) return [];
    const apiKey = this.config.get<string>('JUPITER_API_KEY');
    if (!apiKey) throw new BadRequestException('Token search is not configured.');
    const res = await fetch(`${JUPITER_TOKENS}?query=${encodeURIComponent(q)}`, {
      headers: { 'x-api-key': apiKey },
    });
    if (!res.ok) {
      this.logger.warn(`[GiveawayToken] Jupiter search failed (${res.status})`);
      return [];
    }
    const data = await res.json();
    const rows = Array.isArray(data) ? data : [];
    return rows.slice(0, 8).map((t) => this.mapHit(t)).filter((t): t is JupiterTokenHit => t != null);
  }

  /** On-chain mint check plus Jupiter metadata when the mint is listed. USDC is refused —
   *  that prize type already exists and must not go through a swap. */
  async resolveMint(mint: string): Promise<JupiterTokenHit> {
    let pk: PublicKey;
    try {
      pk = new PublicKey(mint.trim());
    } catch {
      throw new BadRequestException('That is not a Solana mint address.');
    }
    const mintStr = pk.toBase58();
    if (mintStr === USDC_MAINNET || mintStr === USDC_DEVNET) {
      throw new BadRequestException('For a USDC prize, choose the USDC option.');
    }
    const conn = this.solanaSponsor.getConnectionForCluster('mainnet');
    const info = await conn.getAccountInfo(pk);
    if (!info) throw new BadRequestException('No token exists at that mint address.');
    const owner = info.owner.toBase58();
    if (owner !== CLASSIC_TOKEN_PROGRAM && owner !== TOKEN_2022) {
      throw new BadRequestException('That address is not an SPL token mint.');
    }
    const onchain = await getMint(conn, pk, 'confirmed', new PublicKey(owner));
    const listed = await this.search(mintStr).catch(() => [] as JupiterTokenHit[]);
    const match = listed.find((t) => t.mint === mintStr);
    return {
      mint: mintStr,
      symbol: match?.symbol || `${mintStr.slice(0, 4)}…${mintStr.slice(-4)}`,
      name: match?.name || 'Solana token',
      logo: match?.logo ?? null,
      decimals: onchain.decimals,
      tokenProgram: owner,
      usdPrice: match?.usdPrice ?? null,
      verified: Boolean(match?.verified),
    };
  }

  /**
   * Swap `amountIn` base units of USDC held by `taker` into `outputMint`. Returns the output
   * token balance that landed in the taker's ATA (the whole ATA if it started empty).
   */
  async swapUsdcForToken(params: {
    conn: Connection;
    taker: Keypair;
    outputMint: string;
    outputTokenProgram: string;
    amountIn: bigint;
  }): Promise<{ signature: string; outAmount: bigint }> {
    const apiKey = this.config.get<string>('JUPITER_API_KEY');
    if (!apiKey) throw new Error('JUPITER_API_KEY not configured — cannot swap the giveaway prize');
    if (params.amountIn <= 0n) throw new Error('Prize swap amount is zero');

    await this.ensureSwapSol(params.conn, params.taker);

    const programId = new PublicKey(params.outputTokenProgram || CLASSIC_TOKEN_PROGRAM);
    const outputMintPk = new PublicKey(params.outputMint);
    const outputAta = await getAssociatedTokenAddress(outputMintPk, params.taker.publicKey, false, programId);
    let before = 0n;
    try {
      before = (await getAccount(params.conn, outputAta, 'confirmed', programId)).amount;
    } catch {
      before = 0n;
    }

    const qs = new URLSearchParams({
      inputMint: USDC_MAINNET,
      outputMint: params.outputMint,
      amount: params.amountIn.toString(),
      taker: params.taker.publicKey.toBase58(),
      slippageBps: '100',
    });
    const orderRes = await fetch(`${JUPITER_SWAP}/order?${qs.toString()}`, { headers: { 'x-api-key': apiKey } });
    if (!orderRes.ok) {
      throw new Error(`Jupiter order failed (${orderRes.status}): ${(await orderRes.text()).slice(0, 300)}`);
    }
    const order = await orderRes.json();
    if (!order.transaction) throw new Error(order.errorMessage || 'Jupiter did not return a swap transaction');

    const tx = VersionedTransaction.deserialize(Buffer.from(order.transaction, 'base64'));
    tx.sign([params.taker]);
    const signedBase64 = Buffer.from(tx.serialize()).toString('base64');
    const execRes = await fetch(`${JUPITER_SWAP}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ signedTransaction: signedBase64, requestId: order.requestId }),
    });
    if (!execRes.ok) {
      throw new Error(`Jupiter execute failed (${execRes.status}): ${(await execRes.text()).slice(0, 300)}`);
    }
    const result = await execRes.json();
    if (result.status !== 'Success' || !result.signature) {
      throw new Error(result.error || 'Prize swap failed to land on-chain');
    }

    let after = before;
    for (let i = 0; i < 8; i++) {
      try {
        after = (await getAccount(params.conn, outputAta, 'confirmed', programId)).amount;
        if (after > before) break;
      } catch {
        /* ATA not visible yet */
      }
      await new Promise((r) => setTimeout(r, 750));
    }
    const outAmount = after > before ? after - before : BigInt(order.outAmount ?? 0);
    if (outAmount <= 0n) throw new Error(`Prize swap ${result.signature} landed with no output tokens`);
    return { signature: result.signature as string, outAmount };
  }

  /** Jupiter's swap is signed and paid by the burner. A fresh burner has no SOL. */
  private async ensureSwapSol(conn: Connection, taker: Keypair): Promise<void> {
    const needed = 10_000_000;
    const bal = await conn.getBalance(taker.publicKey);
    if (bal >= needed) return;
    const feePayer = this.solanaSponsor.getFeePayerKeypair();
    if (!feePayer) throw new Error('Giveaway sponsorship is not configured (SOLANA_FEE_PAYER_PRIVATE_KEY missing).');
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: feePayer.publicKey,
        toPubkey: taker.publicKey,
        lamports: needed - bal,
      }),
    );
    tx.feePayer = feePayer.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
    tx.sign(feePayer);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await this.pollConfirm(conn, sig);
    this.logger.log(`[GiveawayToken] topped up burner ${taker.publicKey.toBase58().slice(0, 8)}… with SOL for the prize swap (${sig})`);
  }

  private async pollConfirm(conn: Connection, signature: string): Promise<void> {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const statuses = await conn.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const status = statuses.value[0];
      if (status?.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.err)}`);
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return;
      await new Promise((r) => setTimeout(r, 1_000));
    }
    throw new Error(`Transaction ${signature} confirmation timed out`);
  }

  private mapHit(t: Record<string, unknown>): JupiterTokenHit | null {
    const mint = typeof t.id === 'string' ? t.id : '';
    if (!mint || mint === USDC_MAINNET) return null;
    const decimals = typeof t.decimals === 'number' ? t.decimals : null;
    if (decimals == null) return null;
    return {
      mint,
      symbol: typeof t.symbol === 'string' && t.symbol ? t.symbol : mint.slice(0, 4),
      name: typeof t.name === 'string' && t.name ? t.name : 'Solana token',
      logo: typeof t.icon === 'string' ? t.icon : null,
      decimals,
      tokenProgram: typeof t.tokenProgram === 'string' ? t.tokenProgram : CLASSIC_TOKEN_PROGRAM,
      usdPrice: typeof t.usdPrice === 'number' ? t.usdPrice : null,
      verified: t.isVerified === true,
    };
  }
}
