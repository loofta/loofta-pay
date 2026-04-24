import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { fetchSolPriceUsd, grossUpForMagicblockFee, TOTAL_FEE_BPS, type MagicblockPrivateTransferTxResponse } from '@/common/magicblock-private-transfer';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';
import { UsersService } from '../users/users.service';
import { SendPaymentEncryptionService } from './encryption.service';
import { decryptWithPassphrase } from './vault/vault-crypto';
import type { PassphraseEncryptedPayload } from './vault/vault-crypto';
import { CreateSendPaymentDto, ClaimSendPaymentDto } from './dto';
import { SendPaymentLink, SendPaymentLinkPublic, SendPaymentLinkStatus } from './entities/send-payment-link.entity';
import { Keypair, Connection, PublicKey, Transaction, AddressLookupTableAccount, SystemProgram } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from '@solana/spl-token';
import { TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { isSolanaDevnetFromConfig, isSolanaLocalhostFromConfig } from '@/common/solana-cluster-env';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bs58Module = require('bs58');
const bs58 = bs58Module?.default ?? bs58Module;

const DECIMALS = 6;
/** SOL for burner to cover claim/reclaim gas (sent to burner, not fee payer). */
const BURNER_SOL_LAMPORTS = 500_000;

@Injectable()
export class SendPaymentService {
  private readonly logger = new Logger(SendPaymentService.name);
  private readonly baseUrl: string;
  private readonly connection: Connection;
  private readonly feePayerKeypair: Keypair | null = null;
  private readonly usdcMint: PublicKey;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly encryption: SendPaymentEncryptionService,
  ) {
    const mintStr =
      this.configService.get<string>('SOLANA_USDC_MINT') ||
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    this.usdcMint = new PublicKey(mintStr);
    this.baseUrl = this.configService.get<string>('NEXT_PUBLIC_BASE_URL', 'https://pay.loofta.xyz');
    const rpcUrl =
      this.configService.get<string>('SOLANA_RPC_URL') ||
      (this.configService.get<string>('HELIUS_API_KEY')
        ? `https://mainnet.helius-rpc.com/?api-key=${this.configService.get('HELIUS_API_KEY')}`
        : 'https://api.mainnet-beta.solana.com');
    this.connection = new Connection(rpcUrl, 'confirmed');
    const pkRaw = this.configService.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY');
    const pk = typeof pkRaw === 'string' ? pkRaw.trim().replace(/^["']|["']$/g, '') : '';
    this.logger.log(
      `[SendPayment] SOLANA_FEE_PAYER_PRIVATE_KEY: ${pk ? `present (length=${pk.length})` : 'NOT SET'}`,
    );
    if (pk) {
      try {
        let secret: Uint8Array;
        const first = pk.charAt(0);
        if (first === '[' || first === '{') {
          const arr = JSON.parse(pk) as number[];
          if (!Array.isArray(arr) || arr.length !== 64) {
            throw new Error('Key must be 64-byte array when using JSON format');
          }
          secret = Uint8Array.from(arr);
        } else {
          const decoded = bs58.decode(pk);
          secret = decoded instanceof Uint8Array ? decoded : new Uint8Array(decoded);
        }
        if (secret.length !== 32 && secret.length !== 64) {
          throw new Error(`Key must be 32 or 64 bytes after decode, got ${secret.length}`);
        }
        const keypair = Keypair.fromSecretKey(secret);
        this.feePayerKeypair = keypair;
        this.logger.log(`[SendPayment] Fee sponsor ENABLED: payer ${keypair.publicKey.toBase58().slice(0, 8)}...`);
      } catch (e) {
        const err = e as Error;
        this.logger.warn(
          `[SendPayment] Invalid SOLANA_FEE_PAYER_PRIVATE_KEY: ${err.message}. Send-payment claim/reclaim sponsorship disabled.`,
        );
      }
    } else {
      this.logger.warn(
        '[SendPayment] SOLANA_FEE_PAYER_PRIVATE_KEY not set; claim/reclaim will fail until set in backend env.',
      );
    }
  }

  /** True when SOLANA_FEE_PAYER_PRIVATE_KEY is set and valid (claim/reclaim + private pay gas can be sponsored). */
  isSponsorshipConfigured(): boolean {
    return this.feePayerKeypair !== null;
  }

  /**
   * Build unsigned MagicBlock private transfer; recipient pubkey comes from DB only
   * (not sent from the client). Only the link sender may call.
   */
  async buildPrivateTransferForSender(
    linkId: string,
    privyUserId: string,
    senderWallet: string,
  ): Promise<MagicblockPrivateTransferTxResponse> {
    const { requestMagicblockPrivateTransfer } = await import('@/common/magicblock-private-transfer');
    const link = await this.getOne(linkId);
    if (link.sender_user_id !== privyUserId) {
      throw new ForbiddenException('Not the sender of this link');
    }
    const row = link as { recipient_solana_pubkey?: string | null };
    const to = (row.recipient_solana_pubkey || '').trim();
    if (!to || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(to)) {
      throw new BadRequestException('Recipient is not resolved for this link');
    }
    const amountUsd = parseFloat(String(link.amount || '0'));
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      throw new BadRequestException('Invalid amount');
    }
    const baseUnits = Math.round(amountUsd * 1_000_000);
    const solPrice = await fetchSolPriceUsd();
    const grossUnits = grossUpForMagicblockFee(baseUnits, solPrice);
    const cluster = isSolanaLocalhostFromConfig(this.configService) ? 'localhost' : isSolanaDevnetFromConfig(this.configService) ? 'devnet' : 'mainnet';
    // On devnet/localhost MagicBlock passes amount straight to recipient (no fee deduction).
    // Apply 10 BPS gross-up so the surplus lands in the tx; mainnet uses full gross (10 BPS + gas).
    const devnetUnits = Math.ceil((baseUnits * 10_000) / (10_000 - TOTAL_FEE_BPS));
    const transferUnits = cluster === 'mainnet' ? grossUnits : devnetUnits;
    this.logger.log(`[SendPayment] amount=${amountUsd} net=${baseUnits} gross=${grossUnits} transfer=${transferUnits} cluster=${cluster} solPrice=${solPrice}`);
    const txResponse = await requestMagicblockPrivateTransfer({
      from: senderWallet.trim(),
      to,
      mint: this.usdcMint.toBase58(),
      amount: transferUnits,
      cluster,
    });

    // On devnet Privy doesn't support fee sponsoring — inject our fee payer so the
    // user's wallet only needs to provide one signature (theirs), not pay the fee.
    if (cluster === 'devnet' && this.feePayerKeypair) {
      this.logger.log(
        `[SendPayment] Devnet fee sponsor: applying to MagicBlock tx | requiredSigners=[${txResponse.requiredSigners.join(', ')}] blockhash=${txResponse.recentBlockhash?.slice(0, 8)}...`,
      );
      try {
        const rpcUrl =
          this.configService.get<string>('SOLANA_RPC_URL')?.trim() ||
          'https://api.devnet.solana.com';
        const sponsorConn = new Connection(rpcUrl, 'confirmed');
        const { blockhash, lastValidBlockHeight } = await sponsorConn.getLatestBlockhash('confirmed');
        const txBuffer = Buffer.from(txResponse.transactionBase64, 'base64');
        let serialized: Uint8Array;
        // Try legacy first; fall back to v0 with ALT resolution (MagicBlock now uses LUTs)
        try {
          const legacy = Transaction.from(txBuffer);
          legacy.recentBlockhash = blockhash;
          legacy.feePayer = this.feePayerKeypair.publicKey;
          legacy.partialSign(this.feePayerKeypair);
          serialized = legacy.serialize({ requireAllSignatures: false, verifySignatures: false });
        } catch {
          const v0 = VersionedTransaction.deserialize(txBuffer);
          const vMsg = v0.message;
          const altAccounts: AddressLookupTableAccount[] = [];
          for (const lookup of vMsg.addressTableLookups) {
            const result = await sponsorConn.getAddressLookupTable(lookup.accountKey);
            if (result.value) altAccounts.push(result.value);
          }
          this.logger.log(
            `[SendPayment] Devnet fee sponsor: v0 tx | ALTs=${vMsg.addressTableLookups.length} resolved=${altAccounts.length}`,
          );
          const decompiledMsg = TransactionMessage.decompile(vMsg, { addressLookupTableAccounts: altAccounts });
          // MagicBlock internally transfers SOL from the sender's wallet to create the
          // ephemeral shuttle account. Prepend a top-up if the sender has insufficient SOL.
          const senderPk = vMsg.staticAccountKeys[0];
          const SHUTTLE_TOPUP_LAMPORTS = 3_000_000;
          const senderBalance = await sponsorConn.getBalance(senderPk);
          const prefundIxs: ReturnType<typeof SystemProgram.transfer>[] = [];
          if (senderBalance < SHUTTLE_TOPUP_LAMPORTS) {
            const topUp = SHUTTLE_TOPUP_LAMPORTS - senderBalance;
            prefundIxs.push(
              SystemProgram.transfer({ fromPubkey: this.feePayerKeypair.publicKey, toPubkey: senderPk, lamports: topUp }),
            );
            this.logger.log(
              `[SendPayment] Devnet fee sponsor: prefunding sender ${senderPk.toBase58().slice(0, 8)}... +${topUp} lamports (was ${senderBalance})`,
            );
          }
          const newMsg = new TransactionMessage({
            payerKey: this.feePayerKeypair.publicKey,
            recentBlockhash: blockhash,
            instructions: [...prefundIxs, ...decompiledMsg.instructions],
          }).compileToV0Message(altAccounts);
          const newV0 = new VersionedTransaction(newMsg);
          newV0.sign([this.feePayerKeypair]);
          serialized = newV0.serialize();
        }
        this.logger.log(
          `[SendPayment] Devnet fee sponsor applied: feePayer=${this.feePayerKeypair.publicKey.toBase58().slice(0, 8)}... newBlockhash=${blockhash.slice(0, 8)}... txBytes=${serialized.length}`,
        );
        return {
          ...txResponse,
          transactionBase64: Buffer.from(serialized).toString('base64'),
          recentBlockhash: blockhash,
          lastValidBlockHeight,
        };
      } catch (e) {
        this.logger.warn(
          `[SendPayment] Devnet fee sponsor failed, returning unsponsored tx: ${String(e)}`,
        );
      }
    }

    return txResponse;
  }

  /**
   * Create a send payment link (MagicBlock PER). Resolves recipient Solana pubkey for email/username;
   * Twitter handles require a matching Loofta account (use email or username instead).
   */
  async create(senderUserId: string, dto: CreateSendPaymentDto): Promise<{
    id: string;
    link: string;
    deposit_address: string;
    amount: string;
    token: string;
    burner_address: string;
    required_sol_lamports: number;
    per_mode: true;
  }> {
    const recipientIdentifier = this.normalizeIdentifier(dto.recipient_type, dto.recipient_identifier);
    const amountStr = String(dto.amount);

    // Always create a burner regardless of whether the recipient is registered.
    // The sender never needs to know the recipient's real wallet — all deposits go through
    // the burner intermediary, and the backend sweeps to the real wallet after claiming.
    const resolvedRecipientPubkey = await this.resolveRecipientSolanaPubkey(dto, recipientIdentifier);
    const burner = Keypair.generate();
    const burnerAddress = burner.publicKey.toBase58();
    const burnerEncryptedSecret = this.encryption.encrypt(Buffer.from(burner.secretKey));
    // For PER: target = burner (funds held there until recipient claims).
    const recipientSolanaPubkey = burnerAddress;

    this.logger.log(
      `[SendPayment] Created burner for ${dto.recipient_type}:${recipientIdentifier} (recipient known: ${!!resolvedRecipientPubkey})`,
    );

    let depositAddress = '';
    try {
      const burnerPubkey = new PublicKey(burnerAddress);
      depositAddress = (await getAssociatedTokenAddress(this.usdcMint, burnerPubkey)).toBase58();
    } catch {
      depositAddress = '';
    }

    const { data, error } = await this.supabaseService.sendPaymentLinks
      .insert({
        sender_user_id: senderUserId,
        amount: amountStr,
        token: 'USDC',
        chain: 'solana',
        recipient_type: dto.recipient_type,
        recipient_identifier: recipientIdentifier,
        status: 'OPEN',
        burner_address: burnerAddress,
        burner_encrypted_secret: burnerEncryptedSecret,
        // Store the real recipient pubkey in DB only — never returned to the sender.
        recipient_solana_pubkey: resolvedRecipientPubkey ?? recipientSolanaPubkey,
        message: dto.message || null,
        is_devnet: isSolanaDevnetFromConfig(this.configService),
      })
      .select('id')
      .single();

    if (error) {
      this.logger.error('Failed to create send payment link:', error);
      throw new BadRequestException('Failed to create send payment link');
    }

    const link = `${this.baseUrl}/s/${data.id}`;

    return {
      id: data.id,
      link,
      deposit_address: depositAddress,
      amount: amountStr,
      token: 'USDC',
      burner_address: burnerAddress,
      required_sol_lamports: BURNER_SOL_LAMPORTS,
      per_mode: true,
    };
  }

  private async resolveRecipientSolanaPubkey(
    dto: CreateSendPaymentDto,
    recipientIdentifier: string,
  ): Promise<string | null> {
    try {
      if (dto.recipient_type === 'username') {
        const u = await this.usersService.findByUsername(dto.recipient_identifier);
        return await this.usersService.getSolanaWalletAddress(u.privyUserId);
      }
      if (dto.recipient_type === 'email') {
        const u = await this.usersService.findByEmail(dto.recipient_identifier);
        return await this.usersService.getSolanaWalletAddress(u.privyUserId);
      }
      if (dto.recipient_type === 'twitter') {
        // For @handle recipients without account yet, we fallback to burner pending flow.
        return null;
      }
    } catch (e) {
      this.logger.warn(`resolveRecipientSolanaPubkey failed (${dto.recipient_type}): ${(e as Error)?.message}`);
      return null;
    }
    return null;
  }

  /**
   * List send payment links created by the given user (for recovery after reload).
   */
  async listBySender(senderUserId: string): Promise<
    { id: string; amount: string; token: string; status: string; recipient_type: string; created_at: string }[]
  > {
    const { data, error } = await this.supabaseService.sendPaymentLinks
      .select('id, amount, token, status, recipient_type, created_at')
      .eq('sender_user_id', senderUserId)
      .eq('is_devnet', isSolanaDevnetFromConfig(this.configService))
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      this.logger.warn('listBySender failed:', error);
      return [];
    }
    return (data ?? []).map((row) => ({
      id: row.id,
      amount: row.amount,
      token: row.token,
      status: row.status,
      recipient_type: row.recipient_type,
      created_at: row.created_at,
    }));
  }

  /**
   * Get public details for a send payment link (no sensitive data).
   * If userId is provided and matches sender, includes is_sender: true.
   */
  async getPublic(id: string, userId?: string): Promise<SendPaymentLinkPublic & { deposit_address?: string; is_sender?: boolean }> {
    const { data, error } = await this.supabaseService.sendPaymentLinks
      .select('id, amount, token, chain, recipient_type, status, message, burner_address, sender_user_id, recipient_solana_pubkey')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException('Send payment link not found');
    }

    let deposit_address: string | null = null;
    if (data.burner_address && data.status !== 'CLAIMED' && data.status !== 'CANCELLED') {
      try {
        const burnerPubkey = new PublicKey(data.burner_address);
        const ata = await getAssociatedTokenAddress(this.usdcMint, burnerPubkey);
        deposit_address = ata.toBase58();
      } catch {
        deposit_address = null;
      }
    }

    const is_sender = Boolean(userId && data.sender_user_id === userId);

    return {
      id: data.id,
      amount: data.amount,
      token: data.token,
      chain: data.chain,
      recipient_type: data.recipient_type,
      status: data.status,
      message: data.message,
      // Only expose the derived ATA deposit address (not the underlying burner wallet or
      // recipient pubkey — those are never returned to the public to preserve recipient privacy).
      deposit_address: deposit_address ?? undefined,
      required_sol_lamports: data.burner_address ? BURNER_SOL_LAMPORTS : 0,
      ...(is_sender ? { is_sender: true } : {}),
    };
  }

  /**
   * Mark link as funded (deposit detected). Can be called by frontend after user sends USDC.
   */
  async confirmFunded(id: string, depositTxHash: string | null, senderUserId: string): Promise<SendPaymentLinkPublic> {
    const link = await this.getOne(id);
    if (link.sender_user_id !== senderUserId) {
      throw new ForbiddenException('Not the sender of this link');
    }
    if (link.status !== 'OPEN') {
      throw new BadRequestException('Link is not in OPEN status');
    }

    const { data, error } = await this.supabaseService.sendPaymentLinks
      .update({
        status: 'FUNDED',
        ...(depositTxHash ? { deposit_tx_hash: depositTxHash } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new BadRequestException('Failed to update');
    return this.toPublic(data);
  }

  /**
   * Claim: verify claimant identity via Privy, then transfer from burner to claimant embedded wallet
   */
  async claim(
    id: string,
    claimantPrivyUserId: string,
    dto?: ClaimSendPaymentDto,
  ): Promise<{ claim_tx_hash: string; amount_received: string }> {
    const link = await this.getOne(id);
    if (link.status === 'CLAIMED') {
      throw new BadRequestException('This link has already been claimed');
    }
    if (link.status === 'CANCELLED' || link.status === 'EXPIRED') {
      throw new BadRequestException('This link is no longer claimable');
    }
    if (link.status !== 'FUNDED' && link.status !== 'OPEN') {
      throw new BadRequestException('Link is not ready to claim');
    }

    const linkAny = link as unknown as Record<string, unknown>;
    if (!link.burner_encrypted_secret && linkAny.recipient_solana_pubkey) {
      if (link.status !== 'FUNDED') {
        throw new BadRequestException(
          'Payment not yet received. The sender must complete the private MagicBlock transfer first.',
        );
      }
      const matchesPer = await this.usersService.verifyRecipientIdentityForSendPayment(
        claimantPrivyUserId,
        link.recipient_type as 'email' | 'twitter' | 'username',
        link.recipient_identifier,
      );
      if (!matchesPer) {
        throw new ForbiddenException(
          'You are not the intended recipient of this payment. Log in with the account the sender used.',
        );
      }
      const recipientWalletAddr = await this.usersService.getSolanaWalletAddress(claimantPrivyUserId);
      if (recipientWalletAddr !== String(linkAny.recipient_solana_pubkey)) {
        throw new ForbiddenException('Recipient wallet does not match this payment link.');
      }
      const { error: claimErr } = await this.supabaseService.sendPaymentLinks
        .update({
          status: 'CLAIMED',
          receiver_privy_user_id: claimantPrivyUserId,
          claim_tx_hash: 'per-magicblock',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (claimErr) throw new BadRequestException('Failed to update link');
      this.logger.log(`[SendPayment] PER claim completed linkId=${id} correlationId=${id}`);
      return {
        claim_tx_hash: 'per-magicblock',
        amount_received: parseFloat(String(link.amount)).toFixed(DECIMALS),
      };
    }

    const matches = await this.usersService.verifyRecipientIdentityForSendPayment(
      claimantPrivyUserId,
      link.recipient_type as 'email' | 'twitter' | 'username',
      link.recipient_identifier,
    );
    if (!matches) {
      this.logger.warn(`Claim identity mismatch: link ${id} expects ${link.recipient_type}:***, claimant ${claimantPrivyUserId}`);
      throw new ForbiddenException('You are not the intended recipient of this payment. Log in with the email or Twitter account it was sent to.');
    }

    const recipientWallet = await this.usersService.getSolanaWalletAddress(claimantPrivyUserId);

    const linkRow = link as typeof link & {
      private_claim_encrypted_receiver?: string | null;
      private_claim_passphrase?: string | null;
    };

    const mint = this.usdcMint;
    const recipientPubkey = new PublicKey(recipientWallet);
    const recipientAta = await getAssociatedTokenAddress(mint, recipientPubkey);

    type BurnerWithBalance = { keypair: Keypair; ata: PublicKey; balance: bigint };
    const candidates: BurnerWithBalance[] = [];

    // Original burner (deposit_address shown to sender)
    if (link.burner_encrypted_secret) {
      const secretKey = this.encryption.decrypt(link.burner_encrypted_secret);
      const keypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
      const ata = await getAssociatedTokenAddress(mint, keypair.publicKey);
      let balance = BigInt(0);
      try {
        const acc = await getAccount(this.connection, ata);
        balance = acc.amount;
      } catch {
        // ATA may not exist yet
      }
      candidates.push({ keypair, ata, balance });
    }

    // Private-claim burner (used when sender did "Pay privately")
    if (
      link.status === 'FUNDED' &&
      linkRow.private_claim_encrypted_receiver &&
      linkRow.private_claim_passphrase
    ) {
      try {
        const payload: PassphraseEncryptedPayload =
          typeof linkRow.private_claim_encrypted_receiver === 'string'
            ? (JSON.parse(linkRow.private_claim_encrypted_receiver) as PassphraseEncryptedPayload)
            : (linkRow.private_claim_encrypted_receiver as PassphraseEncryptedPayload);
        const secretKey = decryptWithPassphrase(payload, linkRow.private_claim_passphrase);
        const keypair = Keypair.fromSecretKey(secretKey);
        const ata = await getAssociatedTokenAddress(mint, keypair.publicKey);
        let balance = BigInt(0);
        try {
          const acc = await getAccount(this.connection, ata);
          balance = acc.amount;
        } catch {
          // ATA may not exist yet
        }
        // Only add if different from original (avoid double-adding same burner)
        if (!candidates.some((c) => c.keypair.publicKey.equals(keypair.publicKey))) {
          candidates.push({ keypair, ata, balance });
        }
      } catch (e) {
        this.logger.warn(`Claim: failed to decrypt private-claim burner for link ${id}`, (e as Error)?.message);
      }
    }

    const withBalance = candidates.filter((c) => c.balance > BigInt(0));
    if (withBalance.length === 0) {
      throw new BadRequestException('Payment not yet received. The sender must send USDC to the deposit address first.');
    }

    const totalBalance = withBalance.reduce((sum, c) => sum + c.balance, BigInt(0));
    this.logger.log(
      `[SendPayment] Claim ${id}: transferring from ${withBalance.length} burner(s), total raw=${totalBalance} (${Number(totalBalance) / Math.pow(10, DECIMALS)} USDC)`,
    );

    const instructions = [];
    try {
      await getAccount(this.connection, recipientAta);
    } catch {
      if (!this.feePayerKeypair) {
        this.logger.error(
          `[SendPayment] Claim ${id}: recipient ATA missing and sponsorship NOT configured (SOLANA_FEE_PAYER_PRIVATE_KEY unset or invalid). Check backend startup logs for "[SendPayment] SOLANA_FEE_PAYER_PRIVATE_KEY".`,
        );
        throw new BadRequestException(
          'Cannot create recipient token account; sponsorship not configured. ' +
            'Set SOLANA_FEE_PAYER_PRIVATE_KEY in the backend env and fund that wallet with SOL. ' +
            'See apps/backend/env.template.',
        );
      }
      instructions.push(
        createAssociatedTokenAccountInstruction(
          this.feePayerKeypair.publicKey,
          recipientAta,
          recipientPubkey,
          mint,
        ),
      );
    }
    for (const { keypair, ata, balance } of withBalance) {
      instructions.push(createTransferInstruction(ata, recipientAta, keypair.publicKey, balance));
    }

    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
    if (!this.feePayerKeypair) {
      this.logger.error(
        `[SendPayment] Claim ${id}: sponsorship NOT configured at gas step. Restart backend after setting SOLANA_FEE_PAYER_PRIVATE_KEY in apps/backend/.env.local`,
      );
      throw new BadRequestException(
        'Sponsorship not configured; cannot pay gas for claim. ' +
          'Set SOLANA_FEE_PAYER_PRIVATE_KEY in the backend env and fund that wallet with SOL.',
      );
    }
    const signers = [this.feePayerKeypair, ...withBalance.map((c) => c.keypair)];
    const message = new TransactionMessage({
      payerKey: this.feePayerKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign(signers);

    const signature = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });
    await this.connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed',
    );

    await this.supabaseService.sendPaymentLinks
      .update({
        status: 'CLAIMED',
        claim_tx_hash: signature,
        receiver_privy_user_id: claimantPrivyUserId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    const amountReceived = Number(totalBalance) / Math.pow(10, DECIMALS);
    this.logger.log(`Send payment ${id} claimed by ${claimantPrivyUserId}, amount ${amountReceived} USDC, tx ${signature}`);

    return {
      claim_tx_hash: signature,
      amount_received: amountReceived.toFixed(DECIMALS),
    };
  }

  /**
   * Sender reclaim: transfer from burner(s) back to sender.
   * - OPEN/FUNDED: reclaim all funds and mark link CANCELLED.
   * - CLAIMED: reclaim leftover (e.g. funds still in original burner after recipient claimed from private burner).
   */
  async reclaim(id: string, senderUserId: string): Promise<{ reclaim_tx_hash: string; amount_reclaimed: string }> {
    const link = await this.getOne(id);
    if (link.sender_user_id !== senderUserId) {
      throw new ForbiddenException('Only the sender can reclaim');
    }
    if (link.status !== 'OPEN' && link.status !== 'FUNDED' && link.status !== 'CLAIMED') {
      throw new BadRequestException('Link cannot be reclaimed');
    }
    if (!link.burner_encrypted_secret) {
      if (link.status === 'OPEN') {
        await this.supabaseService.sendPaymentLinks
          .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
          .eq('id', id);
        return { reclaim_tx_hash: 'cancelled-per', amount_reclaimed: '0' };
      }
      throw new BadRequestException(
        'This link uses MagicBlock PER. Use the app to move funds from program deposits.',
      );
    }

    const linkRow = link as typeof link & {
      private_claim_encrypted_receiver?: string | null;
      private_claim_passphrase?: string | null;
      private_claim_activity_id?: string | null;
    };

    const mint = this.usdcMint;
    const senderWallet = await this.usersService.getSolanaWalletAddress(senderUserId);
    const senderPubkey = new PublicKey(senderWallet);
    const senderAta = await getAssociatedTokenAddress(mint, senderPubkey);

    type BurnerWithBalance = { keypair: Keypair; ata: PublicKey; balance: bigint };
    const candidates: BurnerWithBalance[] = [];

    // Original burner
    const secretKey = this.encryption.decrypt(link.burner_encrypted_secret);
    const originalKeypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
    const originalAta = await getAssociatedTokenAddress(mint, originalKeypair.publicKey);
    let originalBalance = BigInt(0);
    try {
      const acc = await getAccount(this.connection, originalAta);
      originalBalance = acc.amount;
    } catch {
      // ATA may not exist
    }
    candidates.push({ keypair: originalKeypair, ata: originalAta, balance: originalBalance });

    // Private-claim burner (may have leftover)
    if (
      linkRow.private_claim_encrypted_receiver &&
      linkRow.private_claim_passphrase
    ) {
      try {
        const payload: PassphraseEncryptedPayload =
          typeof linkRow.private_claim_encrypted_receiver === 'string'
            ? (JSON.parse(linkRow.private_claim_encrypted_receiver) as PassphraseEncryptedPayload)
            : (linkRow.private_claim_encrypted_receiver as PassphraseEncryptedPayload);
        const decrypted = decryptWithPassphrase(payload, linkRow.private_claim_passphrase);
        const keypair = Keypair.fromSecretKey(decrypted);
        const ata = await getAssociatedTokenAddress(mint, keypair.publicKey);
        let balance = BigInt(0);
        try {
          const acc = await getAccount(this.connection, ata);
          balance = acc.amount;
        } catch {
          // ATA may not exist
        }
        if (!candidates.some((c) => c.keypair.publicKey.equals(keypair.publicKey))) {
          candidates.push({ keypair, ata, balance });
        }
      } catch (e) {
        this.logger.warn(`Reclaim: failed to decrypt private-claim burner for link ${id}`, (e as Error)?.message);
      }
    }

    const withBalance = candidates.filter((c) => c.balance > BigInt(0));
    if (withBalance.length === 0) {
      const originalBal = candidates[0]?.balance ?? BigInt(0);
      const privateBal = candidates.length > 1 ? candidates[1].balance : BigInt(0);
      this.logger.warn(
        `[SendPayment] Reclaim ${id}: no balance on burners. Original burner: ${Number(originalBal) / 1e6} USDC, private burner: ${Number(privateBal) / 1e6} USDC. Link amount: ${link.amount}.`,
      );
      if (link.status === 'CLAIMED') {
        const usedPrivate = Boolean(linkRow.private_claim_activity_id);
        const message = usedPrivate
          ? 'No leftover on burners. If you used Pay privately, remaining funds may still be in Privacy Cash. Please contact support with this link ID so we can help recover them.'
          : 'No leftover funds to reclaim';
        throw new BadRequestException(message);
      }
      await this.supabaseService.sendPaymentLinks
        .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
        .eq('id', id);
      throw new BadRequestException('No funds to reclaim');
    }

    const totalBalance = withBalance.reduce((sum, c) => sum + c.balance, BigInt(0));
    this.logger.log(
      `[SendPayment] Reclaim ${id} (${link.status}): transferring from ${withBalance.length} burner(s), total ${Number(totalBalance) / Math.pow(10, DECIMALS)} USDC`,
    );

    if (!this.feePayerKeypair) {
      throw new BadRequestException(
        'Sponsorship not configured for reclaim. Set SOLANA_FEE_PAYER_PRIVATE_KEY and fund with SOL.',
      );
    }

    const instructions = [];
    try {
      await getAccount(this.connection, senderAta);
    } catch {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          this.feePayerKeypair.publicKey,
          senderAta,
          senderPubkey,
          mint,
        ),
      );
    }
    for (const { keypair, ata, balance } of withBalance) {
      instructions.push(createTransferInstruction(ata, senderAta, keypair.publicKey, balance));
    }

    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
    const signers = [this.feePayerKeypair, ...withBalance.map((c) => c.keypair)];
    const message = new TransactionMessage({
      payerKey: this.feePayerKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign(signers);

    const signature = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });
    await this.connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed',
    );

    const amountReclaimed = Number(totalBalance) / Math.pow(10, DECIMALS);
    const updatePayload: { status?: string; claim_tx_hash?: string; updated_at: string } = {
      updated_at: new Date().toISOString(),
    };
    if (link.status === 'OPEN' || link.status === 'FUNDED') {
      updatePayload.status = 'CANCELLED';
      updatePayload.claim_tx_hash = signature;
    }
    await this.supabaseService.sendPaymentLinks.update(updatePayload).eq('id', id);

    this.logger.log(`Send payment ${id} reclaimed by sender, ${amountReclaimed} USDC, tx ${signature}`);
    return { reclaim_tx_hash: signature, amount_reclaimed: amountReclaimed.toFixed(DECIMALS) };
  }

  private async getOne(id: string): Promise<SendPaymentLink & { burner_encrypted_secret?: string }> {
    const { data, error } = await this.supabaseService.sendPaymentLinks
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) {
      throw new NotFoundException('Send payment link not found');
    }
    return data as any;
  }

  private normalizeIdentifier(type: 'email' | 'twitter' | 'username', value: string): string {
    const v = value.trim();
    if (type === 'email') return v.toLowerCase();
    return v.replace(/^@/, '').toLowerCase();
  }

  private toPublic(row: any): SendPaymentLinkPublic {
    return {
      id: row.id,
      amount: row.amount,
      token: row.token,
      chain: row.chain,
      recipient_type: row.recipient_type,
      status: row.status,
      message: row.message,
    };
  }
}
