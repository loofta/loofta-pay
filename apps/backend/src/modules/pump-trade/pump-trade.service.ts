import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';
import BN from 'bn.js';
import {
  OnlinePumpSdk,
  PUMP_SDK,
  getBuyV3TokenAmountFromQuoteAmount,
  getSellSolAmountFromTokenAmount,
} from '@pump-fun/pump-sdk';
import { getMainnetSolanaRpcUrl } from '@/common/solana-cluster-env';
import { UsersService } from '@/modules/users/users.service';
import { JupiterService } from '@/modules/jupiter/jupiter.service';
import { MiniRewardsService } from '@/modules/mini-rewards/mini-rewards.service';
import { PumpTradeDto } from './dto/pump-trade.dto';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';
/** Left in the wallet on a buy for the coin's token account rent and the network fee. */
const BUY_RESERVE_LAMPORTS = 5_000_000;
const COMPUTE_UNITS = 300_000;
/** Micro-lamports per compute unit. 100_000 x 300_000 units = 30_000 lamports, a few thousandths of a cent. */
const PRIORITY_MICRO_LAMPORTS = 100_000;
const DEFAULT_SLIPPAGE_BPS = 500;
/** Marker the app looks for to fall back to Jupiter. */
export const PUMP_UNSUPPORTED = 'PUMP_UNSUPPORTED';

type Plan = {
  userWallet: string;
  userPk: PublicKey;
  mint: PublicKey;
  side: 'buy' | 'sell';
  /** What goes in, in base units (lamports on a buy, coin units on a sell). */
  inAmount: BN;
  /** What the person gets, before slippage, in base units (coin units on a buy, lamports on a sell). */
  outAmount: BN;
  minOutAmount: BN;
  /** Loofta's fee in lamports. */
  feeLamports: BN;
  /** The fee rate used, which is lower for people with the referral discount. */
  feeBps: number;
  priceImpactPct: number;
  needsAccountRent: boolean;
  outDecimals: number;
  inDecimals: number;
  instructions: TransactionInstruction[];
};

const bp = (v: BN, bps: number) => v.muln(bps).divn(10_000);
const num = (v: BN) => Number(v.toString());

/**
 * Trades coins that are still on the Pump bonding curve, straight against Pump's own program with the official SDK.
 * No third party sits in the middle and there is no extra fee: the person pays Pump's own fee plus Loofta's 0.30%.
 *
 * The person always pays their own network fee and signs the only signature, so the platform wallet is never the fee
 * payer here and cannot be drained through this route. Every transaction is simulated before it is handed back, so a
 * coin the SDK cannot trade is refused up front and the app falls back to Jupiter.
 */
@Injectable()
export class PumpTradeService {
  private readonly logger = new Logger(PumpTradeService.name);
  private readonly connection: Connection;
  private readonly sdk: OnlinePumpSdk;

  constructor(
    config: ConfigService,
    private readonly users: UsersService,
    private readonly jupiter: JupiterService,
    private readonly rewards: MiniRewardsService,
  ) {
    this.connection = new Connection(getMainnetSolanaRpcUrl(config), 'confirmed');
    this.sdk = new OnlinePumpSdk(this.connection);
  }

  private unsupported(reason: string): never {
    throw new BadRequestException(`${PUMP_UNSUPPORTED}: ${reason}`);
  }

  private toBase(amount: string, decimals: number): BN {
    const [whole, frac = ''] = amount.split('.');
    if (frac.length > decimals) throw new BadRequestException(`At most ${decimals} decimal places.`);
    const v = new BN(whole + frac.padEnd(decimals, '0'));
    if (v.lten(0)) throw new BadRequestException('Invalid amount');
    return v;
  }

  private async plan(userId: string, dto: PumpTradeDto): Promise<Plan> {
    const userWallet = await this.users.getSolanaWalletAddress(userId);
    const userPk = new PublicKey(userWallet);
    const mint = new PublicKey(dto.mint);
    const slippagePct = (dto.slippageBps ?? DEFAULT_SLIPPAGE_BPS) / 100;

    const mintInfo = await this.connection.getAccountInfo(mint);
    if (!mintInfo) this.unsupported('unknown coin');
    // Pump's v3 trades are for create_v2 coins, which are Token-2022. Older coins go to Jupiter.
    if (!mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) this.unsupported('not a v2 pump coin');
    const tokenProgram = TOKEN_2022_PROGRAM_ID;

    const [global, feeConfig] = await Promise.all([this.sdk.fetchGlobal(), this.sdk.fetchFeeConfig()]);
    const feeWallet = this.jupiter.platformFeeWallet;
    const feeBps = await this.rewards.feeBpsFor(userId);
    const sells = dto.side === 'sell';

    const mintDecimals = (await getMint(this.connection, mint, 'confirmed', tokenProgram)).decimals;
    const budget = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICRO_LAMPORTS }),
    ];

    // Only coins still on the curve, and only the ones that trade against plain SOL. Anything else needs a token the person does not hold.
    const assertTradable = (s: { bondingCurve: { complete: boolean }; quoteMint: PublicKey }) => {
      if (s.bondingCurve.complete) this.unsupported('already graduated');
      if (s.quoteMint.toBase58() !== WSOL_MINT) this.unsupported('not quoted in SOL');
    };

    if (!sells) {
      const state = await this.sdk.fetchBuyState(mint, userPk, tokenProgram);
      assertTradable(state);
      const { bondingCurve, quoteTokenProgram, associatedUserAccountInfo, curveBaseTokenBalance } = state;
      const total = this.toBase(dto.amount, 9);
      const lamports = await this.connection.getBalance(userPk);
      if (new BN(lamports).lt(total.addn(BUY_RESERVE_LAMPORTS))) {
        throw new BadRequestException('Not enough SOL for this buy plus the network fee. Lower the amount or add SOL.');
      }
      // Loofta's cut comes off the top and the rest goes to the curve, so what they typed is what they spend.
      const feeLamports = feeWallet ? bp(total, feeBps) : new BN(0);
      const quoteAmount = total.sub(feeLamports);
      const tokens = getBuyV3TokenAmountFromQuoteAmount({
        global,
        feeConfig,
        mintSupply: bondingCurve.tokenTotalSupply,
        bondingCurve,
        amount: quoteAmount,
        curveBaseTokenBalance,
      });
      if (tokens.lten(0)) this.unsupported('no tokens left on the curve');
      const ixs = await PUMP_SDK.buyExactQuoteInV3Instructions({
        bondingCurve,
        associatedUserAccountInfo,
        mint,
        user: userPk,
        quoteAmount,
        amount: tokens,
        slippage: slippagePct,
        quoteTokenProgram,
        tokenProgram,
      });
      const spot = num(bondingCurve.virtualTokenReserves) / Math.max(1, num(bondingCurve.virtualQuoteReserves));
      const ideal = num(quoteAmount) * spot;
      return {
        userWallet,
        userPk,
        mint,
        side: 'buy',
        inAmount: total,
        outAmount: tokens,
        minOutAmount: tokens.muln(Math.floor((1 - slippagePct / 100) * 10_000)).divn(10_000),
        feeLamports,
        feeBps,
        priceImpactPct: ideal > 0 ? Math.max(0, (1 - num(tokens) / ideal) * 100) : 0,
        needsAccountRent: !associatedUserAccountInfo,
        outDecimals: mintDecimals,
        inDecimals: 9,
        instructions: [
          ...budget,
          ...ixs,
          ...(feeWallet && feeLamports.gtn(0) ? [SystemProgram.transfer({ fromPubkey: userPk, toPubkey: feeWallet, lamports: BigInt(feeLamports.toString()) })] : []),
        ],
      };
    }

    const state = await this.sdk.fetchSellState(mint, userPk, tokenProgram).catch(() => {
      throw new BadRequestException('You do not hold this coin.');
    });
    assertTradable(state);
    const { bondingCurve, quoteTokenProgram } = state;
    const amount = this.toBase(dto.amount, mintDecimals);
    const ata = getAssociatedTokenAddressSync(mint, userPk, false, tokenProgram);
    const held = await this.connection.getTokenAccountBalance(ata).catch(() => null);
    if (!held || new BN(held.value.amount).lt(amount)) throw new BadRequestException('You do not hold that many of this coin.');

    const solOut = getSellSolAmountFromTokenAmount({
      global,
      feeConfig,
      mintSupply: bondingCurve.tokenTotalSupply,
      bondingCurve,
      amount,
      quoteTransferFee: state.quoteTransferFee,
    });
    if (solOut.lten(0)) this.unsupported('nothing to sell into');
    const ixs = await PUMP_SDK.sellV3Instructions({
      bondingCurve,
      mint,
      user: userPk,
      amount,
      quoteAmount: solOut,
      slippage: slippagePct,
      tokenProgram,
      quoteTokenProgram,
    });
    const feeLamports = feeWallet ? bp(solOut, feeBps) : new BN(0);
    const spot = num(bondingCurve.virtualQuoteReserves) / Math.max(1, num(bondingCurve.virtualTokenReserves));
    const ideal = num(amount) * spot;
    const net = solOut.sub(feeLamports);
    return {
      userWallet,
      userPk,
      mint,
      side: 'sell',
      inAmount: amount,
      outAmount: net,
      minOutAmount: net.muln(Math.floor((1 - slippagePct / 100) * 10_000)).divn(10_000),
      feeLamports,
      feeBps,
      priceImpactPct: ideal > 0 ? Math.max(0, (1 - num(solOut) / ideal) * 100) : 0,
      needsAccountRent: false,
      outDecimals: 9,
      inDecimals: mintDecimals,
      // The fee is taken from the SOL the sale pays out, after the sale lands.
      instructions: [
        ...budget,
        ...ixs,
        ...(feeWallet && feeLamports.gtn(0) ? [SystemProgram.transfer({ fromPubkey: userPk, toPubkey: feeWallet, lamports: BigInt(feeLamports.toString()) })] : []),
      ],
    };
  }

  private quoteShape(p: Plan) {
    return {
      inAmount: p.inAmount.toString(),
      outAmount: p.outAmount.toString(),
      minOutAmount: p.minOutAmount.toString(),
      feeBps: p.feeLamports.isZero() ? 0 : p.feeBps,
      feeAmount: p.feeLamports.toString(),
      priceImpactPct: p.priceImpactPct,
      needsAccountRent: p.needsAccountRent,
      gasless: false as const,
      inDecimals: p.inDecimals,
      outDecimals: p.outDecimals,
      route: 'pump' as const,
    };
  }

  async quote(userId: string, dto: PumpTradeDto) {
    return this.quoteShape(await this.plan(userId, dto));
  }

  async build(userId: string, dto: PumpTradeDto) {
    const p = await this.plan(userId, dto);
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
    const message = new TransactionMessage({ payerKey: p.userPk, recentBlockhash: blockhash, instructions: p.instructions }).compileToV0Message();
    const tx = new VersionedTransaction(message);

    // The person must be the only signer and the payer of what they are asked to sign.
    if (tx.message.header.numRequiredSignatures !== 1 || !tx.message.staticAccountKeys[0].equals(p.userPk)) {
      this.logger.error(`[PumpTrade] unexpected signer layout for user ${userId}; refusing`);
      throw new BadRequestException('Could not build a safe transaction. Try again.');
    }

    // Run it first. If Pump's program would refuse it, say so now instead of after the person signs.
    const sim = await this.connection.simulateTransaction(tx, { sigVerify: false, commitment: 'confirmed' });
    if (sim.value.err) {
      const why = (sim.value.logs ?? []).filter((l) => /Error Code|Error Message/.test(l)).slice(-1)[0] ?? JSON.stringify(sim.value.err);
      this.logger.warn(`[PumpTrade] simulation refused ${p.side} of ${p.mint.toBase58()}: ${why}`);
      this.unsupported('this coin cannot be traded on the curve right now');
    }

    return {
      ...this.quoteShape(p),
      swapTransaction: Buffer.from(tx.serialize()).toString('base64'),
      lastValidBlockHeight,
    };
  }
}
