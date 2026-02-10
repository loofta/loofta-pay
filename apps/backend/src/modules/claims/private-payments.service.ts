import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import { SupabaseService } from '@/database/supabase.service';

const PROGRAM_ID = new PublicKey(
  process.env.PRIVATE_PAYMENTS_PROGRAM_ID ||
    'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS',
);
const USDC_MINT = new PublicKey(
  process.env.USDC_MINT_SOLANA ||
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
);
const DEPOSIT_SEED = Buffer.from('deposit');
const CONFIG_SEED = Buffer.from('config');

function getDepositPda(user: PublicKey, tokenMint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [DEPOSIT_SEED, user.toBuffer(), tokenMint.toBuffer()],
    PROGRAM_ID,
  );
  return pda;
}

function getConfigPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [CONFIG_SEED],
    PROGRAM_ID,
  );
  return pda;
}

/** Anchor instruction discriminator: first 8 bytes of sha256("global:pay_with_authorization") */
function payWithAuthorizationDiscriminator(): Buffer {
  const h = createHash('sha256')
    .update('global:pay_with_authorization')
    .digest();
  return Buffer.from(h.subarray(0, 8));
}

@Injectable()
export class PrivatePaymentsService {
  private readonly logger = new Logger(PrivatePaymentsService.name);
  private readonly perRpcUrl: string;
  private readonly platformKeypair: Keypair | null;

  constructor(
    private readonly configService: ConfigService,
    private readonly supabase: SupabaseService,
  ) {
    this.perRpcUrl =
      this.configService.get<string>('PER_RPC_URL') ||
      this.configService.get<string>('MAGICBLOCK_URL') ||
      'https://devnet.magicblock.app';
    const secret = this.configService.get<string>('PRIVATE_PAYMENTS_PLATFORM_SECRET');
    if (secret) {
      try {
        const buf = Buffer.from(secret, 'base64');
        this.platformKeypair = Keypair.fromSecretKey(new Uint8Array(buf));
      } catch {
        this.platformKeypair = Keypair.fromSecretKey(
          new Uint8Array(JSON.parse(secret)),
        );
      }
    } else {
      this.platformKeypair = null;
    }
  }

  isConfigured(): boolean {
    return !!this.platformKeypair;
  }

  /**
   * Return private-pay info for a claim. Recipient wallet is never sent to client.
   */
  async getPrivatePayInfo(claimId: string): Promise<{
    recipientDepositPda: string;
    amount: string;
    tokenMint: string;
    claimId: string;
  }> {
    const { data: claim, error } = await this.supabase.claims
      .select('id, amount, to_symbol, to_chain, recipient_address, is_private, status')
      .eq('id', claimId)
      .single();

    if (error || !claim) {
      throw new NotFoundException('Claim not found');
    }
    if (claim.status !== 'OPEN') {
      throw new BadRequestException('Claim is not open for payment');
    }
    if (claim.to_chain !== 'solana' || claim.to_symbol !== 'USDC') {
      throw new BadRequestException('Private pay only supports Solana USDC');
    }
    if (!claim.is_private) {
      throw new BadRequestException('Claim is not a private payment');
    }

    const recipient = new PublicKey(claim.recipient_address);
    const recipientDepositPda = getDepositPda(recipient, USDC_MINT);

    return {
      recipientDepositPda: recipientDepositPda.toBase58(),
      amount: String(claim.amount),
      tokenMint: USDC_MINT.toBase58(),
      claimId: claim.id,
    };
  }

  /**
   * Build the pay_with_authorization transaction (message only). Caller signs with session key; we add platform and submit.
   */
  async buildPrivatePayTx(params: {
    claimId: string;
    payerPublicKey: string;
    sessionPublicKey: string;
    amountLamports: string;
  }): Promise<{ serializedMessageBase64: string }> {
    if (!this.platformKeypair) {
      throw new BadRequestException('Private payments not configured');
    }

    const info = await this.getPrivatePayInfo(params.claimId);
    const payer = new PublicKey(params.payerPublicKey);
    const sessionPubkey = new PublicKey(params.sessionPublicKey);
    const sourceDeposit = getDepositPda(payer, USDC_MINT);
    const destinationDeposit = new PublicKey(info.recipientDepositPda);
    const configPda = getConfigPda();

    const amount = BigInt(params.amountLamports);
    const data = Buffer.alloc(8 + 8);
    payWithAuthorizationDiscriminator().copy(data, 0);
    data.writeBigUInt64LE(amount, 8);

    const keys = [
      { pubkey: payer, isSigner: false, isWritable: false },
      { pubkey: sessionPubkey, isSigner: true, isWritable: true },
      { pubkey: sourceDeposit, isSigner: false, isWritable: true },
      { pubkey: destinationDeposit, isSigner: false, isWritable: true },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: this.platformKeypair.publicKey, isSigner: true, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys,
      data,
    });

    const connection = new Connection(this.perRpcUrl, 'confirmed');
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhashAndContext('confirmed');
    const message = new TransactionMessage({
      payerKey: sessionPubkey,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    const serialized = Buffer.from(tx.serialize()).toString('base64');
    return { serializedMessageBase64: serialized };
  }

  /**
   * Add platform signature and submit to PER.
   */
  async submitPrivatePay(
    claimId: string,
    signedTxBase64: string,
  ): Promise<{ signature: string }> {
    if (!this.platformKeypair) {
      throw new BadRequestException('Private payments not configured');
    }

    const buf = Buffer.from(signedTxBase64, 'base64');
    const tx = VersionedTransaction.deserialize(buf);
    tx.sign([this.platformKeypair]);

    const connection = new Connection(this.perRpcUrl, 'confirmed');
    const sig = await connection.sendTransaction(tx, {
      skipPreflight: true,
      maxRetries: 3,
    });

    this.logger.log(`Private pay submitted for claim ${claimId}: ${sig}`);
    return { signature: sig };
  }
}
