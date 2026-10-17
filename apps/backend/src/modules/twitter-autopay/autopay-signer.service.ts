import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrivyClient } from '@privy-io/server-auth';
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createTransferCheckedInstruction,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { PrivyVerificationService } from '@/auth/privy-verification.service';
import { SolanaSponsorService } from '../claims/solana-sponsor.service';
import { getMainnetSolanaRpcUrl } from '@/common/solana-cluster-env';

const USDC_DECIMALS = 6;

/**
 * Signs and submits the sender->burner leg of a Twitter auto-pay transfer using the Privy
 * authorization key granted via /app/twitter-bot's "Give Loofta access to fund" flow — no live
 * browser session, no client-side signature. Mirrors apps/frontend/src/services/solanaTransfer.ts
 * (buildUSDCTransferTransaction) + privyEmbeddedUsdcSend.ts's flow, just with the sender's
 * signature produced server-side instead of in-browser.
 *
 * The fee payer co-sign + all of SolanaSponsorService.signAndBroadcast's existing guards
 * (program whitelist, ATA-mint whitelist, per-user/per-wallet ATA-creation caps) apply exactly
 * as they do to every other payment path — this doesn't bypass any of that, it just produces a
 * sender-signed transaction the same way a browser would, then hands it to the same broadcaster.
 */
@Injectable()
export class AutopaySignerService {
  private readonly logger = new Logger(AutopaySignerService.name);
  private readonly signingClient: PrivyClient | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly privyVerification: PrivyVerificationService,
    private readonly solanaSponsor: SolanaSponsorService,
  ) {
    const appId = this.config.get<string>('PRIVY_APP_ID');
    const appSecret = this.config.get<string>('PRIVY_APP_SECRET');
    const authorizationPrivateKey = this.config.get<string>('LOOFTA_BOT_AUTH_PRIVATE_KEY');
    if (appId && appSecret && authorizationPrivateKey) {
      this.signingClient = new PrivyClient(appId, appSecret, { walletApi: { authorizationPrivateKey } });
      this.logger.log('AutopaySignerService: Privy signing client initialized');
    } else {
      this.logger.warn(
        'AutopaySignerService: LOOFTA_BOT_AUTH_PRIVATE_KEY not configured — auto-pay execution is disabled',
      );
    }
  }

  get isAvailable(): boolean {
    return this.signingClient !== null;
  }

  /**
   * Resolves the sender's Solana embedded wallet address + Privy wallet id. `id` is only
   * populated once the wallet is delegated (i.e. after addSigners on the frontend) — null id
   * means enrollment's signer grant didn't actually take, caller should fail closed, not retry
   * with a guess.
   */
  async resolveSenderWallet(privyUserId: string): Promise<{ address: string; walletId: string } | null> {
    const user = await this.privyVerification.getPrivyUser(privyUserId, { skipCache: true });
    const wallet = user?.linked_accounts?.find(
      (a: any) => a?.type === 'wallet' && a?.chainType === 'solana',
    );
    if (!wallet?.address || !wallet?.id) return null;
    return { address: wallet.address, walletId: wallet.id };
  }

  /**
   * Builds, server-signs (sender leg, via Privy), fee-payer-co-signs, and broadcasts a USDC
   * transfer from the sender's wallet to the given destination (a claim's burner address).
   * Throws on any failure — caller decides what "no successful auto-pay" means for the reply.
   */
  async signAndSendTransfer(params: {
    senderPrivyUserId: string;
    senderWalletId: string;
    senderAddress: string;
    destinationAddress: string;
    amountUsd: number;
    isDevnet: boolean;
    paymentId: string;
  }): Promise<{ signature: string }> {
    if (!this.signingClient) {
      throw new BadRequestException('Auto-pay signing is not configured');
    }

    // Mainnet always goes through the shared Alchemy resolver (see solana-cluster-env.ts) —
    // falling back to SOLANA_RPC_URL/public mainnet-beta here caused the exact "policy
    // violation" RPC rejections that resolver was built to eliminate.
    const rpcUrl = params.isDevnet
      ? this.config.get<string>('SOLANA_DEVNET_RPC_URL') || 'https://api.devnet.solana.com'
      : getMainnetSolanaRpcUrl(this.config);
    const mintAddress = params.isDevnet
      ? this.config.get<string>('SOLANA_USDC_MINT_DEVNET') || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
      : this.config.get<string>('SOLANA_USDC_MINT_MAINNET') || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

    const connection = new Connection(rpcUrl, 'confirmed');
    const mint = new PublicKey(mintAddress);
    const sender = new PublicKey(params.senderAddress);
    const destination = new PublicKey(params.destinationAddress);
    const feePayerAddress = this.solanaSponsor.feePayerAddress;
    if (!feePayerAddress) {
      throw new Error('Fee payer not configured — cannot build auto-pay transaction');
    }
    const feePayer = new PublicKey(feePayerAddress);

    const amountRaw = Math.floor(params.amountUsd * 10 ** USDC_DECIMALS);
    if (amountRaw <= 0) throw new BadRequestException('Amount must be greater than 0');

    const senderAta = getAssociatedTokenAddressSync(mint, sender, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const destinationAta = getAssociatedTokenAddressSync(mint, destination, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

    const instructions: TransactionInstruction[] = [];
    const destinationAccountInfo = await connection.getAccountInfo(destinationAta);
    if (!destinationAccountInfo) {
      // Fee payer covers rent, matching every other sponsored-transfer path in this app.
      instructions.push(
        createAssociatedTokenAccountInstruction(feePayer, destinationAta, destination, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
      );
    }
    // TransferChecked (not plain Transfer) so the Privy policy can pin the mint to USDC as well as
    // cap the amount; plain Transfer carries no mint field to constrain.
    instructions.push(
      createTransferCheckedInstruction(senderAta, mint, destinationAta, sender, amountRaw, USDC_DECIMALS, [], TOKEN_PROGRAM_ID),
    );

    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const message = new TransactionMessage({
      payerKey: feePayer,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();
    const unsignedTx = new VersionedTransaction(message);

    const { signedTransaction } = await this.signingClient.walletApi.solana.signTransaction({
      walletId: params.senderWalletId,
      transaction: unsignedTx,
    });

    const serializedBase64 = Buffer.from((signedTransaction as VersionedTransaction).serialize()).toString('base64');

    const { signature } = await this.solanaSponsor.signAndBroadcast(
      serializedBase64,
      params.isDevnet ? 'devnet' : 'mainnet',
      params.senderPrivyUserId,
      params.paymentId,
    );
    return { signature };
  }
}
