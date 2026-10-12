import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PublicKey, Transaction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { tokenAccountExists } from '@/common/token-account-exists';
import { SupabaseService } from '@/database/supabase.service';
import { isValidSolanaAddress } from '@/common/solana-address';
import {
  requestMagicblockPrivateTransfer,
  toClientResponse,
  decodeActualSenderDebit,
  estimateMagicblockGrossUp,
  resolveMagicblockRelayFeeUsdc,
  fetchSolPriceUsd,
  MAGICBLOCK_VOLUME_FEE_BPS,
  MAGICBLOCK_GAS_SOL,
  MagicblockPrivateTransferClientResponse,
} from '@/common/magicblock-private-transfer';
import { SolanaSponsorService } from '../claims/solana-sponsor.service';
import { NearIntentsService } from '../intents/near-intents.service';
import { Giveaway, GiveawayStatus } from './entities/giveaway.entity';
import { GiveawayBurnerSweepService } from './giveaway-burner-sweep.service';
import { GiveawayTokenService } from './giveaway-token.service';

/**
 * Watches a giveaway's burner balance and flips PENDING_FUNDING -> FUNDED -> OPEN once it's
 * fully funded. Funding itself can arrive two ways — a direct USDC-on-Solana send to the burner,
 * or any-chain via near-intents with `recipient = burner_address` — but both land in the same
 * USDC ATA, so this service only ever needs to check one thing: the burner's on-chain balance.
 */
@Injectable()
export class GiveawayFundingService {
  private readonly logger = new Logger(GiveawayFundingService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly solanaSponsor: SolanaSponsorService,
    private readonly nearIntents: NearIntentsService,
    private readonly burnerSweep: GiveawayBurnerSweepService,
    private readonly tokenService: GiveawayTokenService,
  ) {}

  private cluster(giveaway: Giveaway): 'devnet' | 'mainnet' {
    return giveaway.is_devnet ? 'devnet' : 'mainnet';
  }

  /**
   * Any-chain funding quote — the deposit lands directly in the burner's USDC ATA on Solana,
   * same as a direct send, so no separate confirmation path is needed beyond the balance poll.
   */
  async createFundingQuote(
    giveaway: Giveaway,
    fromToken: { tokenId: string; chain: string; symbol: string; decimals: number },
  ) {
    if (!giveaway.burner_address) {
      throw new BadRequestException('Giveaway has no burner yet — it must be admin-approved first.');
    }
    const toToken = {
      tokenId: giveaway.mint ?? '',
      chain: 'sol',
      symbol: 'USDC',
      decimals: 6,
    };
    return this.nearIntents.getDepositQuote({
      fromToken,
      toToken,
      amountOut: giveaway.funding_required_usd ?? undefined,
      recipient: giveaway.burner_address,
      useExactOutput: true,
    });
  }

  /** Reads the burner's on-chain USDC balance and, if it now covers funding_required_usd, moves
   *  the giveaway PENDING_FUNDING -> FUNDED -> OPEN. Safe to call repeatedly (idempotent no-op
   *  once already FUNDED/OPEN or beyond). Returns the up-to-date confirmed amount for display. */
  async checkAndUpdateFundingStatus(giveaway: Giveaway): Promise<{ fundingConfirmedUsd: number; justFunded: boolean }> {
    if (giveaway.status !== GiveawayStatus.PENDING_FUNDING) {
      return { fundingConfirmedUsd: Number(giveaway.funding_confirmed_usd), justFunded: false };
    }
    if (!giveaway.burner_address || !giveaway.mint) {
      return { fundingConfirmedUsd: 0, justFunded: false };
    }

    const conn = this.solanaSponsor.getConnectionForCluster(this.cluster(giveaway));
    const mint = new PublicKey(giveaway.mint);
    const burnerAta = await getAssociatedTokenAddress(mint, new PublicKey(giveaway.burner_address));

    let baseUnits = 0n;
    try {
      baseUnits = (await getAccount(conn, burnerAta)).amount;
    } catch {
      // ATA doesn't exist yet — no deposit has landed
    }
    const confirmedUsd = Number(baseUnits) / 1_000_000;

    const requiredUsd = Number(giveaway.funding_required_usd ?? 0);
    const justFunded = confirmedUsd >= requiredUsd && requiredUsd > 0;
    // A token prize stays PENDING_FUNDING until the prize USDC (not the platform fee) has been
    // swapped into prize_mint. Opening entries first would let people enter a pool that is still
    // USDC if the swap fails.
    const needsSwap = justFunded && !!giveaway.prize_mint;

    // Optimistic-concurrency guard: funding_required_usd can now change mid-PENDING_FUNDING via
    // GiveawaysService.updateBeforeFunded (blocked once fundingConfirmedUsd > 0, but this cron
    // reads its batch snapshot up to 30s before writing). Scoping the write to the threshold this
    // calculation actually used makes a stale write a no-op instead of committing a decision based
    // on an amount the creator has since changed — the next tick re-reads fresh and gets it right.
    const { error } = await this.supabaseService.giveaways
      .update({
        funding_confirmed_usd: confirmedUsd,
        ...(justFunded && !needsSwap ? { status: GiveawayStatus.OPEN } : {}),
      })
      .eq('id', giveaway.id)
      .eq('funding_required_usd', giveaway.funding_required_usd);
    if (error) {
      this.logger.warn(`[GiveawayFunding] ${giveaway.id}: failed to persist funding status: ${error.message}`);
      return { fundingConfirmedUsd: confirmedUsd, justFunded: false };
    }

    if (needsSwap) {
      try {
        const swapped = await this.swapPrizeIntoEscrow(giveaway, requiredUsd);
        if (!swapped) return { fundingConfirmedUsd: confirmedUsd, justFunded: false };
      } catch (e) {
        this.logger.warn(`[GiveawayFunding] ${giveaway.id}: prize swap failed (stays PENDING_FUNDING, will retry): ${String(e)}`);
        return { fundingConfirmedUsd: confirmedUsd, justFunded: false };
      }
      const { error: openError } = await this.supabaseService.giveaways
        .update({ status: GiveawayStatus.OPEN })
        .eq('id', giveaway.id)
        .eq('status', GiveawayStatus.PENDING_FUNDING);
      if (openError) {
        this.logger.warn(`[GiveawayFunding] ${giveaway.id}: swap landed but failed to open: ${openError.message}`);
        return { fundingConfirmedUsd: confirmedUsd, justFunded: false };
      }
    }

    if (justFunded) {
      this.logger.log(`[GiveawayFunding] ${giveaway.id}: funded (${confirmedUsd} >= ${requiredUsd}) — now OPEN`);
      const { error: eventError } = await this.supabaseService.giveawayEvents.insert([
        { giveaway_id: giveaway.id, type: 'funding_confirmed', payload: { confirmed_usd: confirmedUsd } },
        { giveaway_id: giveaway.id, type: 'entries_opened', payload: null },
      ]);
      if (eventError) this.logger.warn(`[GiveawayFunding] ${giveaway.id}: failed to log funding events: ${eventError.message}`);
    }

    return { fundingConfirmedUsd: confirmedUsd, justFunded };
  }

  /** True once the prize pool sits in prize_mint on the burner. False when another worker holds
   *  the swap lock. Throws when this attempt's swap fails so the caller leaves the giveaway
   *  PENDING_FUNDING. */
  private async swapPrizeIntoEscrow(giveaway: Giveaway, requiredUsd: number): Promise<boolean> {
    if (giveaway.prize_token_base_units && giveaway.prize_swap_tx && !giveaway.prize_swap_tx.startsWith('pending:')) {
      return true;
    }
    const pendingAt = giveaway.prize_swap_tx?.startsWith('pending:') ? Number(giveaway.prize_swap_tx.slice('pending:'.length)) : 0;
    if (pendingAt && Date.now() - pendingAt < 180_000) return false;

    if (!giveaway.burner_address || !giveaway.burner_encrypted_secret || !giveaway.prize_mint || !giveaway.mint) {
      throw new Error('Token prize is missing its burner or mint');
    }
    const lock = `pending:${Date.now()}`;
    const { data: locked } = await this.supabaseService.giveaways
      .update({ prize_swap_tx: lock })
      .eq('id', giveaway.id)
      .eq('prize_swap_tx', giveaway.prize_swap_tx)
      .select('id');
    // prize_swap_tx null doesn't match .eq(null) in PostgREST — match with is.null in that case.
    let ownsLock = (locked?.length ?? 0) > 0;
    if (!ownsLock && giveaway.prize_swap_tx == null) {
      const { data: lockedNull } = await this.supabaseService.giveaways
        .update({ prize_swap_tx: lock })
        .eq('id', giveaway.id)
        .is('prize_swap_tx', null)
        .select('id');
      ownsLock = (lockedNull?.length ?? 0) > 0;
    }
    if (!ownsLock) return false;

    try {
      const prizeUsd = Math.max(0, requiredUsd - Number(giveaway.platform_fee_usd ?? 0));
      const amountIn = BigInt(Math.round(prizeUsd * 1_000_000));
      const conn = this.solanaSponsor.getConnectionForCluster(this.cluster(giveaway));
      const taker = this.burnerSweep.decryptBurner(giveaway.burner_address, giveaway.burner_encrypted_secret);
      const swapped = await this.tokenService.swapUsdcForToken({
        conn,
        taker,
        outputMint: giveaway.prize_mint,
        outputTokenProgram: giveaway.prize_token_program || 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        amountIn,
      });
      const { error } = await this.supabaseService.giveaways
        .update({
          prize_swap_tx: swapped.signature,
          prize_token_base_units: swapped.outAmount.toString(),
        })
        .eq('id', giveaway.id)
        .eq('prize_swap_tx', lock);
      if (error) throw new Error(error.message);
      this.logger.log(`[GiveawayFunding] ${giveaway.id}: swapped ${prizeUsd} USDC into ${giveaway.prize_token_symbol ?? giveaway.prize_mint} (${swapped.outAmount} base units, ${swapped.signature})`);
      return true;
    } catch (e) {
      await this.supabaseService.giveaways
        .update({ prize_swap_tx: null })
        .eq('id', giveaway.id)
        .eq('prize_swap_tx', lock);
      throw e;
    }
  }

  /**
   * Build an unsigned MagicBlock private transfer so the creator can fund the burner from their
   * own wallet without the destination (burner) address appearing in the browser network tab —
   * same "Pay privately" pattern as a single claim payment (see claims.service.ts's
   * buildPrivateTransferForPayer), just funding a giveaway burner instead of a claim burner.
   * No Loofta platform fee here — giveaway funding is priced as a pure MagicBlock cost passthrough,
   * matching computeFundingRequiredUsd in giveaways.service.ts (no platformFeeBps/platformFeeAccount).
   */
  async buildFundingPrivateTransfer(
    giveaway: Giveaway,
    privyUserId: string,
    senderWallet: string,
    requestCluster?: 'devnet' | 'mainnet',
    gasless = true,
  ): Promise<MagicblockPrivateTransferClientResponse> {
    if (giveaway.created_by !== privyUserId) {
      throw new ForbiddenException('Only the creator can fund this giveaway.');
    }
    if (!giveaway.burner_address || !isValidSolanaAddress(giveaway.burner_address)) {
      throw new BadRequestException('This giveaway has no burner yet — it must be admin-approved first.');
    }
    if (giveaway.status !== GiveawayStatus.PENDING_FUNDING) {
      throw new BadRequestException(`Giveaway is ${giveaway.status}, not accepting funding.`);
    }

    const requiredUsd = Number(giveaway.funding_required_usd ?? 0);
    const confirmedUsd = Number(giveaway.funding_confirmed_usd ?? 0);
    const remainingUsd = Math.max(0, requiredUsd - confirmedUsd);
    if (remainingUsd <= 0) {
      throw new BadRequestException('This giveaway is already fully funded.');
    }

    const cluster = requestCluster ?? this.cluster(giveaway);
    const mint = new PublicKey(giveaway.mint ?? '');
    const baseUnits = Math.round(remainingUsd * 1_000_000);

    const relayFeeUnits = gasless ? Math.round((await resolveMagicblockRelayFeeUsdc()) * 1_000_000) : 0;
    const relaySolPriceUsd = gasless ? await fetchSolPriceUsd() : null;
    // exactOut: the burner must receive exactly the remaining amount owed — MagicBlock grosses
    // up the sender's debit internally to cover its own fee (same pattern as claims.service.ts).
    const estimatedMbVolumeFeeUnits = estimateMagicblockGrossUp(baseUnits, MAGICBLOCK_VOLUME_FEE_BPS) - baseUnits;

    this.logger.log(
      `[GiveawayFunding] ${giveaway.id}: building private funding transfer remainingUsd=${remainingUsd} ` +
      `baseUnits=${baseUnits} cluster=${cluster} gasless=${gasless}`,
    );

    const txResponse = await requestMagicblockPrivateTransfer({
      from: senderWallet.trim(),
      to: giveaway.burner_address,
      mint: mint.toBase58(),
      amount: baseUnits,
      cluster,
      exactOut: true,
      ...(gasless ? { gasless: true } : {}),
    });

    const conn = this.solanaSponsor.getConnectionForCluster(cluster);
    const actualDebitUnits = await decodeActualSenderDebit(txResponse.transactionBase64, senderWallet.trim(), mint, conn);
    const estimatedFeeUnits = estimatedMbVolumeFeeUnits + relayFeeUnits;
    const feeUnits = (actualDebitUnits != null && actualDebitUnits > 0 && actualDebitUnits < baseUnits)
      ? estimatedMbVolumeFeeUnits + actualDebitUnits
      : estimatedFeeUnits;

    return toClientResponse(txResponse, {
      feeAmountUsdc: feeUnits / 1_000_000,
      feeBreakdown: {
        looftaBpsUsdc: estimatedMbVolumeFeeUnits / 1_000_000,
        solRecoveryUsdc: relayFeeUnits / 1_000_000,
        solLamports: Math.round(MAGICBLOCK_GAS_SOL * 1e9),
        solPriceUsd: relaySolPriceUsd ?? 0,
      },
    });
  }

  /**
   * Token prize: the creator pays the token itself into the burner and the platform fee in USDC
   * to the Loofta fee wallet, in one transaction. Locks the token amount the first time it's
   * quoted so a price move between the button and the signature doesn't change what they owe.
   * Null when this giveaway is not a token prize, or the prize was already bought with USDC.
   */
  async quoteDirectTokenFunding(giveaway: Giveaway): Promise<{
    symbol: string;
    amount: string;
    baseUnits: string;
    decimals: number;
    feeUsdc: number;
  } | null> {
    if (!giveaway.prize_mint || giveaway.status !== GiveawayStatus.PENDING_FUNDING) return null;
    if (giveaway.prize_swap_tx && !giveaway.prize_swap_tx.startsWith('pending:')) return null;

    const decimals = giveaway.prize_token_decimals ?? (await this.tokenService.resolveMint(giveaway.prize_mint)).decimals;
    let baseUnits = giveaway.prize_token_base_units;
    if (!baseUnits) {
      const token = await this.tokenService.resolveMint(giveaway.prize_mint);
      if (!token.usdPrice || token.usdPrice <= 0) {
        throw new BadRequestException(`No USD price for ${token.symbol} yet, so the token amount can't be priced.`);
      }
      const prizeUsd = Number(giveaway.prize_amount_usd) * Math.max(1, giveaway.winner_count);
      baseUnits = usdToTokenBaseUnits(prizeUsd, token.usdPrice, token.decimals).toString();
      const { data: locked } = await this.supabaseService.giveaways
        .update({ prize_token_base_units: baseUnits, prize_token_decimals: token.decimals })
        .eq('id', giveaway.id)
        .is('prize_token_base_units', null)
        .select('prize_token_base_units');
      const lockedUnits = locked?.[0]?.prize_token_base_units;
      if (!lockedUnits) {
        const { data: fresh } = await this.supabaseService.giveaways
          .select('prize_token_base_units')
          .eq('id', giveaway.id)
          .maybeSingle();
        baseUnits = fresh?.prize_token_base_units ?? baseUnits;
      } else {
        baseUnits = lockedUnits;
      }
    }
    return {
      symbol: giveaway.prize_token_symbol || 'token',
      amount: formatTokenAmount(BigInt(baseUnits), decimals),
      baseUnits,
      decimals,
      feeUsdc: Number(giveaway.platform_fee_usd ?? 0),
    };
  }

  /** Unsigned transaction: prize token → burner, platform fee USDC → Loofta fee wallet. */
  async buildDirectTokenFunding(
    giveaway: Giveaway,
    privyUserId: string,
    senderWallet: string,
  ): Promise<{ transactionBase64: string; symbol: string; amount: string; feeUsdc: number }> {
    if (giveaway.created_by !== privyUserId) throw new ForbiddenException('Only the creator can fund this giveaway.');
    if (!isValidSolanaAddress(senderWallet)) throw new BadRequestException('Sender wallet is not a Solana address.');
    if (giveaway.status !== GiveawayStatus.PENDING_FUNDING) {
      throw new BadRequestException(`Giveaway is ${giveaway.status}, not accepting funding.`);
    }
    const quote = await this.quoteDirectTokenFunding(giveaway);
    if (!quote || !giveaway.prize_mint || !giveaway.burner_address) {
      throw new BadRequestException('This giveaway is not waiting on a token payment.');
    }

    const conn = this.solanaSponsor.getConnectionForCluster(this.cluster(giveaway));
    const feePayer = this.solanaSponsor.getFeePayerKeypair();
    if (!feePayer) throw new BadRequestException('Giveaway sponsorship is not configured.');
    const tokenProgram = new PublicKey(giveaway.prize_token_program || TOKEN_PROGRAM_ID);
    const prizeMint = new PublicKey(giveaway.prize_mint);
    const sender = new PublicKey(senderWallet.trim());
    const burner = new PublicKey(giveaway.burner_address);
    const usdcMint = new PublicKey(giveaway.mint || '');
    const tokenUnits = BigInt(quote.baseUnits);
    const feeUnits = BigInt(Math.round(quote.feeUsdc * 1_000_000));

    const burnerAta = await getAssociatedTokenAddress(prizeMint, burner, false, tokenProgram);
    await this.ensureOwnedAta(conn, feePayer, burnerAta, burner, prizeMint, tokenProgram);
    const feeAta = await getAssociatedTokenAddress(usdcMint, feePayer.publicKey, false, TOKEN_PROGRAM_ID);
    if (feeUnits > 0n) await this.ensureOwnedAta(conn, feePayer, feeAta, feePayer.publicKey, usdcMint, TOKEN_PROGRAM_ID);

    const senderTokenAta = await getAssociatedTokenAddress(prizeMint, sender, false, tokenProgram);
    if (!(await tokenAccountExists(conn, senderTokenAta, { programId: tokenProgram }))) {
      throw new BadRequestException(`Your wallet has no ${quote.symbol} account to pay from.`);
    }
    const senderUsdcAta = await getAssociatedTokenAddress(usdcMint, sender, false, TOKEN_PROGRAM_ID);
    if (feeUnits > 0n && !(await tokenAccountExists(conn, senderUsdcAta, { programId: TOKEN_PROGRAM_ID }))) {
      throw new BadRequestException('Your wallet has no USDC account to pay the platform fee from.');
    }

    const instructions = [
      createTransferCheckedInstruction(
        senderTokenAta,
        prizeMint,
        burnerAta,
        sender,
        tokenUnits,
        quote.decimals,
        [],
        tokenProgram,
      ),
    ];
    if (feeUnits > 0n) {
      instructions.push(createTransferCheckedInstruction(
        senderUsdcAta,
        usdcMint,
        feeAta,
        sender,
        feeUnits,
        6,
        [],
        TOKEN_PROGRAM_ID,
      ));
    }
    const { blockhash } = await conn.getLatestBlockhash('confirmed');
    const message = new TransactionMessage({
      payerKey: feePayer.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();
    return {
      transactionBase64: Buffer.from(new VersionedTransaction(message).serialize()).toString('base64'),
      symbol: quote.symbol,
      amount: quote.amount,
      feeUsdc: quote.feeUsdc,
    };
  }

  /** Confirms the signed funding transaction actually paid the token to the burner and the fee to Loofta. */
  async confirmDirectTokenFunding(giveaway: Giveaway, privyUserId: string, signature: string): Promise<{ opened: boolean }> {
    if (giveaway.created_by !== privyUserId) throw new ForbiddenException('Only the creator can fund this giveaway.');
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) throw new BadRequestException('That is not a transaction signature.');
    if (giveaway.prize_swap_tx === `direct:${signature}`) return { opened: giveaway.status !== GiveawayStatus.PENDING_FUNDING };
    const quote = await this.quoteDirectTokenFunding(giveaway);
    if (!quote || !giveaway.prize_mint || !giveaway.burner_address || !giveaway.mint) {
      throw new BadRequestException('This giveaway is not waiting on a token payment.');
    }

    const conn = this.solanaSponsor.getConnectionForCluster(this.cluster(giveaway));
    const feePayer = this.solanaSponsor.getFeePayerKeypair();
    if (!feePayer) throw new BadRequestException('Giveaway sponsorship is not configured.');
    const tokenProgram = new PublicKey(giveaway.prize_token_program || TOKEN_PROGRAM_ID);
    const burnerAta = await getAssociatedTokenAddress(new PublicKey(giveaway.prize_mint), new PublicKey(giveaway.burner_address), false, tokenProgram);
    const feeAta = await getAssociatedTokenAddress(new PublicKey(giveaway.mint), feePayer.publicKey, false, TOKEN_PROGRAM_ID);
    const paid = await this.readConfirmedTransfers(conn, signature);
    const tokenPaid = paid.get(burnerAta.toBase58()) ?? 0n;
    const feePaid = paid.get(feeAta.toBase58()) ?? 0n;
    const feeUnits = BigInt(Math.round(quote.feeUsdc * 1_000_000));
    if (tokenPaid < BigInt(quote.baseUnits)) {
      throw new BadRequestException(`That transaction sent ${tokenPaid.toString()} token units, and this giveaway needs ${quote.baseUnits}.`);
    }
    if (feePaid < feeUnits) {
      throw new BadRequestException('That transaction did not pay the USDC platform fee to Loofta.');
    }

    const { error } = await this.supabaseService.giveaways
      .update({
        prize_swap_tx: `direct:${signature}`,
        prize_token_base_units: quote.baseUnits,
        funding_confirmed_usd: giveaway.funding_required_usd,
        status: GiveawayStatus.OPEN,
      })
      .eq('id', giveaway.id)
      .eq('status', GiveawayStatus.PENDING_FUNDING);
    if (error) throw new BadRequestException(error.message);
    await this.supabaseService.giveawayEvents.insert([
      { giveaway_id: giveaway.id, type: 'funding_confirmed', payload: { signature, token_base_units: quote.baseUnits, fee_usd: quote.feeUsdc, direct: true } },
      { giveaway_id: giveaway.id, type: 'platform_fee_collected', payload: { signature, amount_usd: quote.feeUsdc } },
      { giveaway_id: giveaway.id, type: 'entries_opened', payload: null },
    ]);
    this.logger.log(`[GiveawayFunding] ${giveaway.id}: direct token funding confirmed ${signature}`);
    return { opened: true };
  }

  /** Creates an ATA we own (burner or our fee wallet). Rent comes back when that account is closed. */
  private async ensureOwnedAta(
    conn: import('@solana/web3.js').Connection,
    feePayer: import('@solana/web3.js').Keypair,
    ata: PublicKey,
    owner: PublicKey,
    mint: PublicKey,
    tokenProgram: PublicKey,
  ): Promise<void> {
    if (await tokenAccountExists(conn, ata, { programId: tokenProgram })) return;
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(feePayer.publicKey, ata, owner, mint, tokenProgram),
    );
    tx.feePayer = feePayer.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
    tx.sign(feePayer);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await conn.confirmTransaction(sig, 'confirmed');
  }

  /** TransferChecked amounts keyed by destination ATA, from a confirmed transaction. */
  private async readConfirmedTransfers(conn: import('@solana/web3.js').Connection, signature: string): Promise<Map<string, bigint>> {
    let parsed: Awaited<ReturnType<typeof conn.getParsedTransaction>> = null;
    for (let attempt = 0; attempt < 8 && !parsed; attempt++) {
      parsed = await conn.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
      if (!parsed) await new Promise((r) => setTimeout(r, 400));
    }
    if (!parsed) throw new BadRequestException('That transaction is not confirmed yet. Wait a moment and try again.');
    if (parsed.meta?.err) throw new BadRequestException('That transaction failed on-chain.');
    const totals = new Map<string, bigint>();
    const lists = [
      ...(parsed.transaction.message.instructions ?? []),
      ...(parsed.meta?.innerInstructions ?? []).flatMap((inner) => inner.instructions),
    ];
    for (const ix of lists) {
      if (!('parsed' in ix)) continue;
      const body = ix.parsed as { type?: string; info?: { destination?: string; tokenAmount?: { amount?: string } } };
      if (body.type !== 'transferChecked' || !body.info?.destination || !body.info.tokenAmount?.amount) continue;
      const dest = body.info.destination;
      totals.set(dest, (totals.get(dest) ?? 0n) + BigInt(body.info.tokenAmount.amount));
    }
    return totals;
  }

  /** Poll target for the funding cron — every giveaway still waiting on a deposit. */
  async findAwaitingFunding(): Promise<Giveaway[]> {
    const { data, error } = await this.supabaseService.giveaways
      .select('*')
      .eq('status', GiveawayStatus.PENDING_FUNDING)
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as Giveaway[];
  }
}

/** ceil(usd / price * 10^decimals), in integer math so a tiny token price doesn't round short. */
function usdToTokenBaseUnits(usd: number, price: number, decimals: number): bigint {
  const priceAtoms = BigInt(Math.round(price * 1e8));
  if (priceAtoms <= 0n) throw new BadRequestException('Token price is not usable.');
  const usdAtoms = BigInt(Math.round(usd * 1e6));
  const scale = 10n ** BigInt(decimals);
  const num = usdAtoms * 100_000_000n * scale;
  const den = priceAtoms * 1_000_000n;
  return (num + den - 1n) / den;
}

function formatTokenAmount(base: bigint, decimals: number): string {
  const scale = 10n ** BigInt(Math.max(0, decimals));
  const whole = base / scale;
  const frac = base % scale;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fracStr}`;
}
