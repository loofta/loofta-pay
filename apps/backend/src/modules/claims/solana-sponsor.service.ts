import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isSolanaDevnetFromConfig, getMainnetSolanaRpcUrl } from '@/common/solana-cluster-env';
import { SupabaseService } from '@/database/supabase.service';
import { EmailService } from '@/modules/email/email.service';
import { guardAtaSponsorship, assertPerUserAtaCreationCapNotExceeded, assertPerWalletAtaCreationCapNotExceeded } from '@/common/ata-sponsorship-guard';
import { ATA_RENT_LAMPORTS } from '@/common/ata-rent-recovery';
import { fetchSolPriceUsd } from '@/common/magicblock-private-transfer';
import { tokenAccountExists } from '@/common/token-account-exists';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  Keypair,
  VersionedTransaction,
  Transaction,
  TransactionMessage,
  AddressLookupTableAccount,
  Connection,
  SystemProgram,
  PublicKey,
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
// bs58 may export default depending on bundler/runtime
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bs58Module = require('bs58');
const bs58 = bs58Module?.default ?? bs58Module;

// Programs allowed in sponsored USDC-transfer transactions.
// Any instruction from an unlisted program is rejected — blocks custom-program drain attacks.
const ALLOWED_SPONSOR_PROGRAMS = new Set([
  '11111111111111111111111111111111',               // System Program
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',  // SPL Token
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Program
  'ComputeBudget111111111111111111111111111111',    // Compute Budget
  'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',  // Memo v1
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',  // Memo v2
]);

// USDC mint addresses. ATA creation is blocked for any other mint.
const USDC_MINT_SET = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC mainnet
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // USDC devnet (Helius)
]);

const ATA_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const TOKEN_PROGRAM_ID_STR = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

// SPL Token instruction discriminators this flow actually needs — a plain USDC transfer (to a
// recipient, or into our own fee-payer ATA for rent recovery). Everything else from the Token
// program is denied by default (allowlist, not a denylist of only the dangerous ones): the
// program-level whitelist above only checks *which program*, not *which instruction*, so without
// this a client could smuggle in an Approve/SetAuthority/Burn/etc. targeting the fee payer's own
// USDC ATA — a single fee-payer signature over the transaction message authorizes every
// instruction that names it as a required signer, not just the ones we intended to allow.
const TOKEN_INSTRUCTION_ALLOWLIST = new Set([3, 12]); // Transfer, TransferChecked

/** Read env var from the active local env file on disk when ConfigService doesn't have it (e.g. run from monorepo root). */
function getEnvFromFile(varName: string): string | null {
  // Match ConfigModule envFilePath: LOOFTA_ENV_FILE (same as SendPaymentService key source) — see app.module.ts
  const envFileName = process.env.LOOFTA_ENV_FILE || '.env.development.local';
  const tryPaths = [
    join(process.cwd(), 'apps', 'backend', envFileName),
    join(process.cwd(), envFileName),
    join(__dirname, '..', '..', '..', envFileName), // backend root from src/modules/claims or dist
    join(__dirname, '..', '..', '..', '..', envFileName),
    join(__dirname, '..', '..', envFileName),
  ];
  for (const p of tryPaths) {
    try {
      if (existsSync(p)) {
        const content = readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
        const lineByLine = content.split(/\r?\n/);
        for (const line of lineByLine) {
          const trimmed = line.trim();
          if (trimmed.startsWith('#') || !trimmed) continue;
          const eq = trimmed.indexOf('=');
          if (eq <= 0) continue;
          const key = trimmed.slice(0, eq).trim().replace(/^\uFEFF/, '');
          if (key === varName) {
            const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
            if (value) return value;
          }
        }
        const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`${escaped}\\s*=\\s*(["']?)([^\\s#'"]+)\\1`);
        const match = content.match(regex);
        if (match?.[2]) return match[2].trim();
      }
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Service to sponsor Solana transaction fees (claim reclaim sweep, send-payment, etc.).
 * SOLANA_FEE_PAYER_PRIVATE_KEY = Solana wallet keypair (base58) that pays tx fees; this wallet must hold SOL.
 * Not the same as SEND_PAYMENT_ENC_KEY (which is an AES key for encrypting burner secrets in the DB).
 */
@Injectable()
export class SolanaSponsorService {
  private readonly logger = new Logger(SolanaSponsorService.name);
  private readonly feePayerKeypair: Keypair | null = null;
  private readonly connection: Connection;
  public readonly feePayerAddress: string | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly supabaseService: SupabaseService,
    private readonly emailService: EmailService,
  ) {
    // Load same way as SendPaymentService so ClaimsService sponsor is available when key is set
    let privateKeyBase58: string | null =
      this.config.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY') ?? process.env.SOLANA_FEE_PAYER_PRIVATE_KEY ?? null;
    if (privateKeyBase58 && typeof privateKeyBase58 === 'string') privateKeyBase58 = privateKeyBase58.trim() || null;
    let source = privateKeyBase58 ? 'config/env' : '';
    // .env.local-on-disk is a local-dev convenience only — a production container should never
    // treat a file on disk as a fallback source of truth for the fee-payer private key.
    if (!privateKeyBase58 && process.env.NODE_ENV !== 'production') {
      privateKeyBase58 = getEnvFromFile('SOLANA_FEE_PAYER_PRIVATE_KEY');
      source = privateKeyBase58 ? 'file' : '';
    }
    if (privateKeyBase58 && typeof privateKeyBase58 === 'string') {
      privateKeyBase58 = privateKeyBase58.trim().replace(/^["']|["']$/g, '') || null;
    }
    const rpcUrl = this.resolveSolanaRpcUrl();
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.logger.log(`SolanaSponsor: using RPC ${rpcUrl}`);

    if (privateKeyBase58) {
      try {
        const decoded = bs58.decode(privateKeyBase58);
        const secret = decoded instanceof Uint8Array ? decoded : new Uint8Array(decoded);
        this.feePayerKeypair = Keypair.fromSecretKey(secret);
        this.feePayerAddress = this.feePayerKeypair.publicKey.toBase58();
        this.logger.log(`SolanaSponsor: SOLANA_FEE_PAYER_PRIVATE_KEY loaded (${source || 'config/env'}); fee payer ${this.feePayerAddress.slice(0, 8)}...`);
      } catch (e) {
        this.logger.error('SolanaSponsor: Invalid SOLANA_FEE_PAYER_PRIVATE_KEY (bad base58 or length)', e);
      }
    } else {
      const fromConfig = !!this.config.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY');
      const fromEnv = !!process.env.SOLANA_FEE_PAYER_PRIVATE_KEY;
      const fromFile = !!getEnvFromFile('SOLANA_FEE_PAYER_PRIVATE_KEY');
      this.logger.warn(
        `SolanaSponsor: SOLANA_FEE_PAYER_PRIVATE_KEY not loaded. config=${fromConfig} process.env=${fromEnv} file=${fromFile} cwd=${process.cwd()}. Add to apps/backend/.env.local (base58 Solana key, wallet needs SOL).`,
      );
    }
  }

  /**
   * Poll until this connection sees the signature (same RPC we broadcast on).
   * Logs periodically when status is still null (helps debug "stuck" sponsor calls).
   */
  private async waitUntilSignatureVisible(
    signature: string,
    timeoutMs = 90_000,
    pollMs = 400,
    label = 'sponsor',
    conn?: Connection,
  ): Promise<void> {
    const pollConn = conn ?? this.connection;
    const start = Date.now();
    let lastProgressLog = 0;
    const rpcEndpoint = pollConn.rpcEndpoint;
    while (Date.now() - start < timeoutMs) {
      const { value } = await pollConn.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      const st = value[0];
      const elapsed = Date.now() - start;
      if (st?.err) {
        throw new Error(`Sponsored transaction failed on-chain: ${JSON.stringify(st.err)}`);
      }
      if (
        st?.confirmationStatus === 'processed' ||
        st?.confirmationStatus === 'confirmed' ||
        st?.confirmationStatus === 'finalized'
      ) {
        this.logger.log(
          `SolanaSponsor[${label}]: signature ${signature.slice(0, 12)}... visible (${st.confirmationStatus}) after ${elapsed}ms rpc=${rpcEndpoint}`,
        );
        return;
      }
      if (elapsed - lastProgressLog >= 5000) {
        lastProgressLog = elapsed;
        const statusHint =
          st === null || st === undefined
            ? 'getSignatureStatuses[0] is null (tx not indexed on this RPC yet)'
            : `status=${JSON.stringify(st)}`;
        this.logger.warn(
          `SolanaSponsor[${label}]: still waiting ${elapsed}ms — ${statusHint} sig=${signature.slice(0, 12)}... rpc=${rpcEndpoint}`,
        );
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new Error(
      `Sponsored transaction not observed on RPC within ${timeoutMs}ms (signature ${signature}). Check SOLANA_RPC_URL matches the app cluster.`,
    );
  }

  private resolveSolanaRpcUrl(): string {
    const isDevnet = isSolanaDevnetFromConfig(this.config) || (() => {
      const cluster =
        this.config.get<string>('SOLANA_CLUSTER')?.trim() ||
        process.env.SOLANA_CLUSTER?.trim() ||
        getEnvFromFile('SOLANA_CLUSTER')?.trim() ||
        this.config.get<string>('NEXT_PUBLIC_SOLANA_CLUSTER')?.trim() ||
        process.env.NEXT_PUBLIC_SOLANA_CLUSTER?.trim() ||
        getEnvFromFile('NEXT_PUBLIC_SOLANA_CLUSTER')?.trim();
      return cluster === 'devnet' || cluster === 'testnet';
    })();

    const helius = this.config.get<string>('HELIUS_API_KEY') || process.env.HELIUS_API_KEY;

    if (isDevnet) {
      // Alchemy has no devnet Solana endpoint — Helius is primary here, same as other backend
      // RPC resolvers (see project_alchemy_rpc_fallback memory).
      const devnetRpc =
        this.config.get<string>('SOLANA_DEVNET_RPC_URL') ??
        process.env.SOLANA_DEVNET_RPC_URL ??
        getEnvFromFile('SOLANA_DEVNET_RPC_URL');
      if (devnetRpc?.trim()) return devnetRpc.trim();
      if (helius) return `https://devnet.helius-rpc.com/?api-key=${helius}`;
      return 'https://api.devnet.solana.com';
    }

    return getMainnetSolanaRpcUrl(this.config);
  }

  isAvailable(): boolean {
    return this.feePayerKeypair !== null && this.feePayerAddress !== null;
  }

  getConnection(): Connection {
    return this.connection;
  }

  getConnectionForCluster(cluster: 'mainnet' | 'devnet'): Connection {
    const helius = this.config.get<string>('HELIUS_API_KEY') || process.env.HELIUS_API_KEY;
    if (cluster === 'mainnet') {
      return new Connection(getMainnetSolanaRpcUrl(this.config), 'confirmed');
    }
    // devnet
    const devnetRpc =
      this.config.get<string>('SOLANA_DEVNET_RPC_URL') ??
      process.env.SOLANA_DEVNET_RPC_URL ??
      getEnvFromFile('SOLANA_DEVNET_RPC_URL');
    if (devnetRpc?.trim()) return new Connection(devnetRpc.trim(), 'confirmed');
    if (helius) return new Connection(`https://devnet.helius-rpc.com/?api-key=${helius}`, 'confirmed');
    return new Connection('https://api.devnet.solana.com', 'confirmed');
  }

  getFeePayerKeypair(): Keypair | null {
    return this.feePayerKeypair;
  }

  getFeePayerAddress(): string | null {
    return this.feePayerAddress;
  }

  /**
   * Extract the non-fee-payer required signers from a base64 serialized transaction.
   * Used by the controller to verify the user signer belongs to the authenticated account.
   * Returns an empty array on parse failure (the full signAndBroadcast will surface the error).
   */
  getRequiredUserSigners(serializedBase64: string): string[] {
    const feePayerAddr = this.feePayerAddress;
    const txBuffer = Buffer.from(serializedBase64, 'base64');
    try {
      const tx = Transaction.from(txBuffer);
      return tx.signatures
        .map((s) => s.publicKey.toBase58())
        .filter((addr) => addr !== feePayerAddr);
    } catch {
      // not a legacy tx — try versioned
    }
    try {
      const vtx = VersionedTransaction.deserialize(txBuffer);
      const numSigners = vtx.message.header.numRequiredSignatures;
      return vtx.message.staticAccountKeys
        .slice(0, numSigners)
        .map((k) => k.toBase58())
        .filter((addr) => addr !== feePayerAddr);
    } catch {
      return [];
    }
  }

  /**
   * Every Associated-Token-Account "create" instruction in this transaction, with the wallet it
   * benefits, the mint, the ATA address, and who funds the rent. Account layout for both the plain
   * and the idempotent create is [payer, ata, owner, mint, systemProgram, tokenProgram].
   */
  private getAtaCreationDetails(
    serializedBase64: string,
  ): { payer: string; owner: string; mint: string; ata: string }[] {
    type Detail = { payer: string; owner: string; mint: string; ata: string };
    const complete = (d: Partial<Detail>): d is Detail =>
      Boolean(d.payer && d.owner && d.mint && d.ata);
    const txBuffer = Buffer.from(serializedBase64, 'base64');
    try {
      const tx = Transaction.from(txBuffer);
      return tx.instructions
        .filter((ix) => ix.programId.toBase58() === ATA_PROGRAM_ID)
        .map((ix) => ({
          payer: ix.keys[0]?.pubkey?.toBase58(),
          ata: ix.keys[1]?.pubkey?.toBase58(),
          owner: ix.keys[2]?.pubkey?.toBase58(),
          mint: ix.keys[3]?.pubkey?.toBase58(),
        }))
        .filter(complete);
    } catch {
      // not a legacy tx — try versioned
    }
    try {
      const vtx = VersionedTransaction.deserialize(txBuffer);
      const accountKeys = vtx.message.getAccountKeys().staticAccountKeys;
      return vtx.message.compiledInstructions
        .filter((ix) => accountKeys[ix.programIdIndex]?.toBase58() === ATA_PROGRAM_ID)
        .map((ix) => ({
          payer: accountKeys[ix.accountKeyIndexes[0]]?.toBase58(),
          ata: accountKeys[ix.accountKeyIndexes[1]]?.toBase58(),
          owner: accountKeys[ix.accountKeyIndexes[2]]?.toBase58(),
          mint: accountKeys[ix.accountKeyIndexes[3]]?.toBase58(),
        }))
        .filter(complete);
    } catch {
      return [];
    }
  }

  /**
   * Sum of SPL Token Transfer/TransferChecked instruction amounts whose destination account is
   * `destinationAtaBase58`. Used to verify a claim payment actually transfers what the claim
   * asks for — a client builds this transaction itself, so nothing stops it from putting in any
   * amount it likes unless something on our side independently re-derives what really moves
   * on-chain instead of trusting the claim id alone to mean "this is legitimate."
   */
  private sumTokenTransfersToDestination(serializedBase64: string, destinationAtaBase58: string): bigint {
    const readAmount = (data: Buffer, discriminator: number): bigint | null => {
      if (data.length < 9 || data[0] !== discriminator) return null;
      return data.readBigUInt64LE(1);
    };
    const txBuffer = Buffer.from(serializedBase64, 'base64');
    try {
      const tx = Transaction.from(txBuffer);
      let total = 0n;
      for (const ix of tx.instructions) {
        if (ix.programId.toBase58() !== TOKEN_PROGRAM_ID_STR) continue;
        if (ix.data[0] === 3) {
          const amount = readAmount(ix.data, 3);
          if (amount !== null && ix.keys[1]?.pubkey?.toBase58() === destinationAtaBase58) total += amount;
        } else if (ix.data[0] === 12) {
          const amount = readAmount(ix.data, 12);
          if (amount !== null && ix.keys[2]?.pubkey?.toBase58() === destinationAtaBase58) total += amount;
        }
      }
      return total;
    } catch {
      // not a legacy tx — try versioned
    }
    try {
      const vtx = VersionedTransaction.deserialize(txBuffer);
      const accountKeys = vtx.message.getAccountKeys().staticAccountKeys;
      let total = 0n;
      for (const ix of vtx.message.compiledInstructions) {
        if (accountKeys[ix.programIdIndex]?.toBase58() !== TOKEN_PROGRAM_ID_STR) continue;
        const data = Buffer.from(ix.data);
        if (data[0] === 3) {
          const amount = readAmount(data, 3);
          if (amount !== null && accountKeys[ix.accountKeyIndexes[1]]?.toBase58() === destinationAtaBase58) total += amount;
        } else if (data[0] === 12) {
          const amount = readAmount(data, 12);
          if (amount !== null && accountKeys[ix.accountKeyIndexes[2]]?.toBase58() === destinationAtaBase58) total += amount;
        }
      }
      return total;
    } catch {
      return 0n;
    }
  }

  /**
   * Total USDC (base units) this transaction pays into our own fee payer's USDC account, across
   * both the mainnet and devnet mints. This is how a client covers costs we'd otherwise absorb —
   * currently the recipient-token-account rent on a plain withdrawal.
   */
  private sumUsdcTransfersToFeePayer(serializedBase64: string): bigint {
    if (!this.feePayerAddress) return 0n;
    let total = 0n;
    for (const mint of USDC_MINT_SET) {
      const feePayerAta = getAssociatedTokenAddressSync(
        new PublicKey(mint),
        new PublicKey(this.feePayerAddress),
      );
      total += this.sumTokenTransfersToDestination(serializedBase64, feePayerAta.toBase58());
    }
    return total;
  }

  /**
   * What `count` new token accounts actually cost us, in USDC base units — the raw rent-exempt
   * deposit at the current SOL price, with no safety margin on top (see the call site: the client
   * quotes with a margin, so demanding it again here would reject legitimate transactions on
   * ordinary price skew between the two feeds).
   *
   * If the price feed is down, falls back to a deliberately LOW flat floor rather than a high one:
   * a too-high requirement rejects real withdrawals, while a too-low one merely lets an attacker
   * underpay slightly on a creation they're still funding — and the volume caps bound that anyway.
   * Being wrong in the lenient direction costs cents; being wrong in the strict direction breaks
   * withdrawals for everyone, which is exactly what happened on 2026-08-07.
   */
  private async ataRentCostUsdcUnits(count: number): Promise<bigint> {
    if (count <= 0) return 0n;
    const FALLBACK_UNITS_PER_ATA = 100_000n; // $0.10 — under the real cost at any plausible SOL price
    const solPriceUsd = await fetchSolPriceUsd().catch(() => null);
    if (!solPriceUsd || solPriceUsd <= 0) {
      this.logger.warn(
        `SolanaSponsor: SOL price unavailable for ATA cost check — falling back to $${Number(FALLBACK_UNITS_PER_ATA) / 1e6}/account so withdrawals keep working`,
      );
      return FALLBACK_UNITS_PER_ATA * BigInt(count);
    }
    const perAtaUsd = (ATA_RENT_LAMPORTS / 1e9) * solPriceUsd;
    return BigInt(Math.floor(perAtaUsd * 1e6)) * BigInt(count);
  }

  /**
   * Refuse to pay ATA rent twice for the same (wallet, mint).
   *
   * The program/mint whitelist below only checks instruction *shape* — right program, right mint.
   * It says nothing about *who benefits*, so on its own it happily lets a caller have us fund a
   * USDC ATA for any wallet they name. Rent (~0.00204 SOL) is only ours to lose once: the wallet's
   * owner can close that account whenever they like and keep the rent, then ask us to fund it
   * again. That create → close → repeat cycle is a free, unbounded drain, and it is exactly what
   * happened on 2026-07-28/29 — ~60 sponsored creations of the single ATA
   * GHzjnYmAHfnpHHtyT9wx7JPoR1XNKoXhWaPFDwyiskoM, one every ~10s, each a bare creation with no
   * transfer attached. Two earlier attempts at this protection existed only on paper: a
   * `getAtaCreationOwners` helper nothing ever called, and an `assertAtaNeverExistedBefore` that
   * was described in controller comments but never written. Hence this being enforced *here*,
   * inside the broadcast path itself, where it cannot be bypassed by a caller that forgets it.
   *
   * Deliberately ownership-agnostic: the destination of a legitimate withdraw-to-external-wallet
   * or first-time payment is never linked to the sender's account, so requiring the ATA owner to
   * be one of the caller's own wallets breaks real flows (confirmed in production 2026-07-17).
   * Keyed on (wallet, mint) via `ata_sponsorships` instead, so the first creation for any
   * destination is free and every repeat is refused.
   *
   * Only guards creations our fee payer actually funds, and only when the ATA does not already
   * exist on-chain — an idempotent create against a live ATA is a no-op that costs no rent, so
   * consuming the one-shot for it would block legitimate repeat sends to the same recipient.
   */
  private async assertAtaCreationsAllowed(
    serializedBase64: string,
    conn: Connection,
    label: string,
    userId?: string,
    claimId?: string,
    pajOrderId?: string,
    nearIntentsOrderId?: string,
    offrampRequestId?: string,
    giveawayId?: string,
  ): Promise<void> {
    const details = this.getAtaCreationDetails(serializedBase64);

    // Claim-amount enforcement — deliberately OUTSIDE the `details.length === 0` early-return
    // below. Everything else in this function only ever runs when the transaction creates a
    // brand-new ATA; a claim paid into a recipient who already has a USDC account skips ALL of
    // it, including the owner-match check further down. That meant a claim's `amount` column was
    // purely decorative for the actual broadcast: nothing compared what a self-built transaction
    // really transfers on-chain against what the claim says it's worth (2026-08-07 finding — see
    // project memory, solana sponsor security hardening). Fetched once here and reused by the
    // owner-match branch below instead of querying `payments` twice.
    let claimRow: { id: string; recipient_address: string | null; burner_address: string | null; amount: number | string | null; created_by: string | null } | null = null;
    if (claimId) {
      const { data, error } = await this.supabaseService.payments
        .select('id, recipient_address, burner_address, amount, created_by')
        .eq('id', claimId)
        .maybeSingle();
      if (error || !data) {
        this.logger.warn(`SolanaSponsor[${label}]: claimId=${claimId} not found — refusing to sponsor (${error?.message ?? 'no row'})`);
        throw new Error('Claim not found; cannot verify this payment.');
      }
      claimRow = data;
      const expectedRecipient = String(claimRow.burner_address || claimRow.recipient_address || '').trim();
      if (!expectedRecipient) {
        this.logger.warn(`SolanaSponsor[${label}]: claimId=${claimId} has no resolvable recipient/burner address — refusing to sponsor`);
        throw new Error('This claim has no resolvable recipient; cannot verify this payment.');
      }
      const claimAmountUsd = parseFloat(String(claimRow.amount ?? '0'));
      if (Number.isFinite(claimAmountUsd) && claimAmountUsd > 0) {
        const requiredUnits = BigInt(Math.round(claimAmountUsd * 1_000_000));
        let paidUnits = 0n;
        for (const mint of USDC_MINT_SET) {
          const destAta = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(expectedRecipient));
          paidUnits += this.sumTokenTransfersToDestination(serializedBase64, destAta.toBase58());
        }
        if (paidUnits < requiredUnits) {
          this.logger.error(
            `SolanaSponsor[${label}]: BLOCKED — claimId=${claimId} expects ${requiredUnits} USDC base units but tx only transfers ${paidUnits} to ${expectedRecipient.slice(0, 8)}… (user=${userId ?? 'unknown'})`,
          );
          throw new Error('This payment does not cover the amount owed on this claim.');
        }
      }
    }

    if (details.length === 0) return;

    // Which creations we would actually be paying rent for right now.
    const chargeable: typeof details = [];
    for (const d of details) {
      if (d.payer !== this.feePayerAddress) continue; // caller funds their own rent — not our loss
      let exists = false;
      try {
        exists = await tokenAccountExists(conn, new PublicKey(d.ata));
      } catch (e) {
        // Fail closed: we could not prove the ATA is already funded, so we cannot prove this
        // creation is free. Refusing costs a retry; guessing wrong costs real SOL, repeatably.
        this.logger.warn(
          `SolanaSponsor[${label}]: ATA existence check failed for ${d.ata.slice(0, 8)}… (${(e as Error)?.message}) — refusing to sponsor rather than risk paying rent twice`,
        );
        throw new Error('Could not verify token account state; please retry');
      }
      if (!exists) chargeable.push(d);
    }
    if (chargeable.length === 0) return;

    // Structured, greppable log line for every chargeable sponsor call — this is what a future
    // "was this a drain" investigation should read first, instead of manually decoding raw
    // transactions off Solscan. `intentSource` says exactly which real backing record justified
    // each of these creations. "UNBOUND" can still appear in this log line (it's computed before
    // the enforcement branches below run), but as of 2026-08-07 it never survives this function —
    // the final `else if (chargeable.length > 0)` branch below refuses any call with no id.
    const intentSource = claimId
      ? `claim:${claimId}`
      : pajOrderId
        ? `pajOrder:${pajOrderId}`
        : nearIntentsOrderId
          ? `nearIntentsOrder:${nearIntentsOrderId}`
          : offrampRequestId
            ? `offrampRequest:${offrampRequestId}`
            : giveawayId
              ? `giveaway:${giveawayId}`
              : 'UNBOUND';
    this.logger.log(
      `SolanaSponsor[${label}] SPONSOR_ATA_CREATE user=${userId ?? 'unknown'} intent=${intentSource} count=${chargeable.length} owners=${chargeable.map((d) => d.owner.slice(0, 8)).join(',')}`,
    );

    // Intent-binding (2026-08-04 fix for the "sign-and-broadcast volume gap", hardened
    // 2026-08-07 — see project memory: solana sponsor security hardening, Attack 6 and the
    // 2026-08-07 recurrence). This endpoint used to accept ANY pre-built transaction with zero
    // context on what it's *for*, so every chargeable creation looked identical to a legitimate
    // first-time payment. The caller must now supply one of claimId/pajOrderId/nearIntentsOrderId
    // /offrampRequestId/giveawayId, and every chargeable ATA's owner must be the EXACT recipient/
    // deposit/burner address that real record has on file — not just "some new wallet, first time
    // we've seen it". A caller can no longer sponsor an arbitrary self-generated wallet: there is
    // no real row backing a destination they invented, and (as of 2026-08-07) no id at all is no
    // longer accepted either — see the final `else if (chargeable.length > 0)` branch below.
    if (claimId && chargeable.length > 0) {
      // claimRow was already fetched (and its amount enforced) above, before the early return.
      const expectedRecipient = String(claimRow!.burner_address || claimRow!.recipient_address || '').trim();
      for (const d of chargeable) {
        if (d.owner !== expectedRecipient) {
          this.logger.error(
            `SolanaSponsor[${label}]: BLOCKED — claimId=${claimId} expects recipient ${expectedRecipient.slice(0, 8)}… but tx creates an ATA for ${d.owner.slice(0, 8)}… (user=${userId ?? 'unknown'})`,
          );
          throw new Error('This transaction does not match the claim it is being paid against.');
        }
      }
      // Self-issued-and-self-paid check (2026-08-07, corrected 2026-08-10 after a false positive
      // blocked a real "Loofta x Paj campaign" payment — payment_id c5c5e123-6db7-4e53-
      // 91b3-dccd9ee78d0c). Originally blocked ANY claim paid by its own creator, on the theory
      // that "a claim exists to be paid by someone other than its creator." That's wrong: claims
      // are routinely created by staff/integrators on behalf of a real third-party recipient
      // (@looftaxyz here), and the creator completing that payment themselves is legitimate —
      // nothing about it resembles the actual exploit.
      //
      // The exploit this exists to stop needs the payer to be able to LATER reclaim the rent
      // themselves, which requires them to hold the destination's private key — impossible when
      // the destination is one of our own generated burners (`burner_address` set): we hold that
      // key, not them, and its rent already comes back to our own fee payer on sweep regardless
      // of who paid it (see claims.service.ts's createCloseAccountInstruction calls). Every claim
      // gets a burner unless creation failed (claims.service.ts:151-154's "always create a
      // burner" policy) or the destination came from the recipient-supplied-raw-address fallback
      // — only THAT narrower case is where self-payment is actually the same shape as the
      // self-issued-claim attack, so it's the only case still blocked here.
      if (userId && !claimRow!.burner_address && claimRow!.created_by && claimRow!.created_by === userId) {
        this.logger.error(
          `SolanaSponsor[${label}]: BLOCKED — claimId=${claimId} (no burner) was created and is being paid by the same user=${userId} — refusing to sponsor a new token account for a self-issued claim`,
        );
        throw new Error('You cannot sponsor a new token account for a claim you created yourself.');
      }
    } else if (pajOrderId && chargeable.length > 0) {
      const { data: orderRow, error: orderLookupError } = await this.supabaseService.pajCashOrders
        .select('id, offramp_deposit_address, user_id')
        .eq('id', pajOrderId)
        .maybeSingle();
      if (orderLookupError || !orderRow) {
        this.logger.warn(`SolanaSponsor[${label}]: pajOrderId=${pajOrderId} not found — refusing to sponsor (${orderLookupError?.message ?? 'no row'})`);
        throw new Error('Offramp order not found; cannot verify this payment.');
      }
      if (userId && orderRow.user_id && orderRow.user_id !== userId) {
        this.logger.error(
          `SolanaSponsor[${label}]: BLOCKED — pajOrderId=${pajOrderId} belongs to a different user than the caller (user=${userId})`,
        );
        throw new Error('This offramp order does not belong to your account.');
      }
      const expectedRecipient = String(orderRow.offramp_deposit_address || '').trim();
      if (!expectedRecipient) {
        this.logger.warn(`SolanaSponsor[${label}]: pajOrderId=${pajOrderId} has no resolvable deposit address — refusing to sponsor`);
        throw new Error('This offramp order has no resolvable destination; cannot verify this payment.');
      }
      for (const d of chargeable) {
        if (d.owner !== expectedRecipient) {
          this.logger.error(
            `SolanaSponsor[${label}]: BLOCKED — pajOrderId=${pajOrderId} expects destination ${expectedRecipient.slice(0, 8)}… but tx creates an ATA for ${d.owner.slice(0, 8)}… (user=${userId ?? 'unknown'})`,
          );
          throw new Error('This transaction does not match the offramp order it is being paid against.');
        }
      }
    } else if (nearIntentsOrderId && chargeable.length > 0) {
      const { data: orderRow, error: orderLookupError } = await this.supabaseService.nearIntentsWithdrawalOrders
        .select('id, deposit_address, user_id')
        .eq('id', nearIntentsOrderId)
        .maybeSingle();
      if (orderLookupError || !orderRow) {
        this.logger.warn(`SolanaSponsor[${label}]: nearIntentsOrderId=${nearIntentsOrderId} not found — refusing to sponsor (${orderLookupError?.message ?? 'no row'})`);
        throw new Error('Withdrawal order not found; cannot verify this payment.');
      }
      if (userId && orderRow.user_id && orderRow.user_id !== userId) {
        this.logger.error(
          `SolanaSponsor[${label}]: BLOCKED — nearIntentsOrderId=${nearIntentsOrderId} belongs to a different user than the caller (user=${userId})`,
        );
        throw new Error('This withdrawal order does not belong to your account.');
      }
      const expectedRecipient = String(orderRow.deposit_address || '').trim();
      if (!expectedRecipient) {
        this.logger.warn(`SolanaSponsor[${label}]: nearIntentsOrderId=${nearIntentsOrderId} has no resolvable deposit address — refusing to sponsor`);
        throw new Error('This withdrawal order has no resolvable destination; cannot verify this payment.');
      }
      for (const d of chargeable) {
        if (d.owner !== expectedRecipient) {
          this.logger.error(
            `SolanaSponsor[${label}]: BLOCKED — nearIntentsOrderId=${nearIntentsOrderId} expects deposit address ${expectedRecipient.slice(0, 8)}… but tx creates an ATA for ${d.owner.slice(0, 8)}… (user=${userId ?? 'unknown'})`,
          );
          throw new Error('This transaction does not match the withdrawal order it is being paid against.');
        }
      }
    } else if (offrampRequestId && chargeable.length > 0) {
      const { data: offrampRow, error: offrampLookupError } = await this.supabaseService.offrampRequests
        .select('id, near_intents_deposit_address, user_id')
        .eq('id', offrampRequestId)
        .maybeSingle();
      if (offrampLookupError || !offrampRow) {
        this.logger.warn(`SolanaSponsor[${label}]: offrampRequestId=${offrampRequestId} not found — refusing to sponsor (${offrampLookupError?.message ?? 'no row'})`);
        throw new Error('Offramp request not found; cannot verify this payment.');
      }
      if (userId && offrampRow.user_id && offrampRow.user_id !== userId) {
        this.logger.error(
          `SolanaSponsor[${label}]: BLOCKED — offrampRequestId=${offrampRequestId} belongs to a different user than the caller (user=${userId})`,
        );
        throw new Error('This offramp request does not belong to your account.');
      }
      const expectedRecipient = String(offrampRow.near_intents_deposit_address || '').trim();
      if (!expectedRecipient) {
        this.logger.warn(`SolanaSponsor[${label}]: offrampRequestId=${offrampRequestId} has no resolvable deposit address — refusing to sponsor`);
        throw new Error('This offramp request has no resolvable destination; cannot verify this payment.');
      }
      for (const d of chargeable) {
        if (d.owner !== expectedRecipient) {
          this.logger.error(
            `SolanaSponsor[${label}]: BLOCKED — offrampRequestId=${offrampRequestId} expects deposit address ${expectedRecipient.slice(0, 8)}… but tx creates an ATA for ${d.owner.slice(0, 8)}… (user=${userId ?? 'unknown'})`,
          );
          throw new Error('This transaction does not match the offramp request it is being paid against.');
        }
      }
    } else if (giveawayId && chargeable.length > 0) {
      const { data: giveawayRow, error: giveawayLookupError } = await this.supabaseService.giveaways
        .select('id, burner_address')
        .eq('id', giveawayId)
        .maybeSingle();
      if (giveawayLookupError || !giveawayRow) {
        this.logger.warn(`SolanaSponsor[${label}]: giveawayId=${giveawayId} not found — refusing to sponsor (${giveawayLookupError?.message ?? 'no row'})`);
        throw new Error('Giveaway not found; cannot verify this payment.');
      }
      const expectedRecipient = String(giveawayRow.burner_address || '').trim();
      if (!expectedRecipient) {
        this.logger.warn(`SolanaSponsor[${label}]: giveawayId=${giveawayId} has no resolvable burner address — refusing to sponsor`);
        throw new Error('This giveaway has no resolvable funding destination; cannot verify this payment.');
      }
      for (const d of chargeable) {
        if (d.owner !== expectedRecipient) {
          this.logger.error(
            `SolanaSponsor[${label}]: BLOCKED — giveawayId=${giveawayId} expects burner ${expectedRecipient.slice(0, 8)}… but tx creates an ATA for ${d.owner.slice(0, 8)}… (user=${userId ?? 'unknown'})`,
          );
          throw new Error('This transaction does not match the giveaway it is funding.');
        }
      }
    } else if (chargeable.length > 0) {
      // No backing intent id — e.g. a plain Solana withdrawal to an address the user typed in.
      // There is nothing to bind against here and never will be: it's just "send my own money to
      // this address", with no backend-tracked record behind it.
      //
      // Paying the ~$0.15 ATA rent for a recipient who has never held USDC is NORMAL, legitimate
      // product cost — it's what has always made "send to any wallet" work, and Loofta has
      // absorbed it for real users since day one. Briefly (2026-08-07 → 2026-08-08) this branch
      // refused these outright, which broke every real withdrawal to a wallet without a USDC
      // account. Do not reintroduce that: the 2026-08-07 drain was never "we pay rent at all",
      // it was ONE actor farming that rent in a loop against wallets they controlled.
      //
      // What it must NOT be, though, is free. The transaction has to pay that rent back to us in
      // USDC — which is exactly what the withdrawal UI now does (BalanceModal charges the setup
      // fee as a second transfer leg in the same signature). That turns the 2026-08-07 attack
      // into a no-op: an attacker farming rent now funds every account they open, so there is
      // nothing left to farm, no matter how many identities they rotate through.
      //
      // The threshold is the RAW rent — deliberately NOT the 1.25x-buffered figure the client
      // quotes from. Client and server price SOL from different feeds at different moments, so
      // requiring the buffered amount here would reject a legitimate withdrawal any time the
      // server's price ticked above the client's. Charging 1.25x and demanding 1.0x leaves ~25%
      // headroom for that skew, which is the whole reason real withdrawals keep working.
      const paidUnits = this.sumUsdcTransfersToFeePayer(serializedBase64);
      const requiredUnits = await this.ataRentCostUsdcUnits(chargeable.length);
      if (paidUnits < requiredUnits) {
        this.logger.error(
          `SolanaSponsor[${label}]: BLOCKED — unbound ATA creation is not self-funded: ${chargeable.length} account(s) cost us ${requiredUnits} USDC base units, tx pays back only ${paidUnits} (user=${userId ?? 'unknown'}, owners=${chargeable.map((d) => d.owner.slice(0, 8)).join(',')})`,
        );
        throw new Error('This transaction does not cover the cost of creating the recipient token account.');
      }
      this.logger.log(
        `SolanaSponsor[${label}]: unbound ATA creation self-funded — ${chargeable.length} account(s), cost ${requiredUnits} USDC base units, tx pays back ${paidUnits} (user=${userId ?? 'unknown'})`,
      );
    }

    // NOTE: this function's intended safety net for volume was pricing — recover the rent from
    // the sender (see quoteAtaRentRecoveryUsdc / ata-rent-recovery.ts) so an unbounded number of
    // creations would be fine because none of them is free to the requester. That pricing was
    // built for multi-send only and was never wired up here, so until it is, a per-user volume
    // cap (shared with every other unpriced sponsor-paid ATA path — see
    // assertPerUserAtaCreationCapNotExceeded) is the real control for THIS endpoint.
    //
    // Applied UNCONDITIONALLY whenever userId is present — previously skipped when
    // claimId/pajOrderId/etc. already verified the destination, on the theory that a real backing
    // record is a strictly stronger check than a volume cap. That reasoning broke in the
    // 2026-08-06 recurrence: claims can be self-created by anyone via POST /claims/create, so an
    // attacker can pay into a claim they authored themselves, targeting a destination they own —
    // intent-binding "passes" every time because the record is real, it's just real AND
    // attacker-controlled. The cap is the only thing that actually bounds this, so it must apply
    // regardless of which intent id (if any) was supplied. Skipped only when userId is absent
    // (cron/backend-only callers have no identity to cap against).
    if (userId) {
      await assertPerUserAtaCreationCapNotExceeded(this.supabaseService, userId, chargeable.length, `SolanaSponsor:${label}`);
    }

    // Second, independent axis on the same cap — see assertPerWalletAtaCreationCapNotExceeded.
    // Derived straight from the transaction, so it applies even when userId didn't resolve, and
    // it's what actually caught the 2026-08-07 recurrence: same signer wallet reused across ~30
    // sponsorships while (apparently) rotating Privy accounts to dodge the check above.
    const primarySigner = this.getRequiredUserSigners(serializedBase64)[0];
    if (primarySigner) {
      await assertPerWalletAtaCreationCapNotExceeded(this.supabaseService, primarySigner, chargeable.length, `SolanaSponsor:${label}`);
    }

    for (const d of chargeable) {
      const allowed = await guardAtaSponsorship(
        this.supabaseService,
        d.owner,
        d.mint,
        `sponsor-broadcast:${label}:user:${userId ?? 'unknown'}`,
        this.emailService,
        userId,
        primarySigner,
      );
      if (!allowed) {
        this.logger.warn(
          `SolanaSponsor[${label}]: BLOCKED repeat sponsored ATA creation owner=${d.owner.slice(0, 8)}… ata=${d.ata.slice(0, 8)}… — rent for this account was already paid once`,
        );
        throw new Error(
          'This token account has already been funded once at our expense and cannot be funded again.',
        );
      }
    }
  }

  /**
   * Rebuild transaction server-side with sponsor fee payer + fresh blockhash.
   * Keeps instructions unchanged so the user can sign client-side afterwards.
   */
  async prepareSponsoredTransaction(serializedTransactionBase64: string): Promise<{ transaction: string }> {
    if (!this.feePayerKeypair || !this.feePayerAddress) {
      throw new Error('Solana fee sponsorship is not configured');
    }

    const t0 = Date.now();
    const feePayerPk = this.feePayerKeypair.publicKey;
    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
    const txBuffer = Buffer.from(serializedTransactionBase64, 'base64');

    // Try legacy first so legacy-in remains legacy-out (PER Anchor flows expect Transaction).
    try {
      const legacy = Transaction.from(txBuffer);
      legacy.recentBlockhash = blockhash;
      legacy.feePayer = feePayerPk;
      const serialized = legacy.serialize({ requireAllSignatures: false, verifySignatures: false });
      this.logger.log(
        `SolanaSponsor[prepare]: legacy tx ${serialized.length}b blockhash=${blockhash.slice(0, 8)}... ${Date.now() - t0}ms rpc=${this.connection.rpcEndpoint}`,
      );
      return { transaction: Buffer.from(serialized).toString('base64') };
    } catch {
      // Fall through to Versioned parsing.
    }

    // Versioned in -> versioned out.
    try {
      const originalV0 = VersionedTransaction.deserialize(txBuffer);
      const originalMsg = TransactionMessage.decompile(originalV0.message);
      const rebuilt = new TransactionMessage({
        payerKey: feePayerPk,
        recentBlockhash: blockhash,
        instructions: originalMsg.instructions,
      }).compileToV0Message();
      const out = new VersionedTransaction(rebuilt);
      const ser = out.serialize();
      this.logger.log(
        `SolanaSponsor[prepare]: legacy parse failed; v0 tx ${ser.length}b blockhash=${blockhash.slice(0, 8)}... ${Date.now() - t0}ms rpc=${this.connection.rpcEndpoint}`,
      );
      return { transaction: Buffer.from(ser).toString('base64') };
    } catch {
      // Fall through to legacy parsing.
    }

    throw new Error('Unsupported or invalid transaction format');
  }

  /**
   * Set our fee payer on the MagicBlock PER transaction, refresh the blockhash, and return the
   * prepared transaction WITHOUT signing. The user wallet signs next via Privy, then the frontend
   * calls signAndBroadcastPER so the fee payer countersigns with the same blockhash the user used.
   *
   * Partial-signing upfront is intentionally avoided: Privy's signTransaction internally calls
   * prepareTransaction which replaces the blockhash, invalidating any existing partial signatures.
   */
  async prepareAndPartialSignTransaction(serializedBase64: string, conn?: Connection): Promise<{
    transactionBase64: string;
    recentBlockhash: string;
    lastValidBlockHeight: number;
    topUpLamports: number;
  }> {
    if (!this.feePayerKeypair) {
      throw new Error('Fee payer not configured for sponsoring');
    }
    const txBuffer = Buffer.from(serializedBase64, 'base64');
    const resolveConn = conn ?? this.connection;
    const { blockhash, lastValidBlockHeight } = await resolveConn.getLatestBlockhash('confirmed');
    const feePayerPk = this.feePayerKeypair.publicKey;

    // Try legacy first — MagicBlock PER private transfer uses legacy transactions
    try {
      const legacy = Transaction.from(txBuffer);
      const originalFeePayer = legacy.feePayer?.toBase58() ?? 'none';
      const originalSignerCount = legacy.signatures.length;
      this.logger.log(
        `SolanaSponsor[prepareAndPartialSign]: overriding feePayer ${originalFeePayer.slice(0, 8)}... → ${feePayerPk.toBase58().slice(0, 8)}... signers=${originalSignerCount} rpc=${this.connection.rpcEndpoint}`,
      );
      legacy.recentBlockhash = blockhash;
      legacy.feePayer = feePayerPk;
      const serialized = legacy.serialize({ requireAllSignatures: false, verifySignatures: false });
      this.logger.log(
        `SolanaSponsor[prepareAndPartialSign]: legacy tx ${serialized.length}b feePayer=${feePayerPk.toBase58().slice(0, 8)}... blockhash=${blockhash.slice(0, 8)}... (unsigned, countersign after user)`,
      );
      return {
        transactionBase64: Buffer.from(serialized).toString('base64'),
        recentBlockhash: blockhash,
        lastValidBlockHeight,
        topUpLamports: 0,
      };
    } catch {
      // fall through to versioned
    }

    // v0 transaction with LUTs (MagicBlock now uses Address Lookup Tables).
    // MagicBlock builds the tx with the sender as fee payer — we must rebuild it with
    // our sponsor as fee payer. That requires resolving the LUT accounts from chain first.
    const originalV0 = VersionedTransaction.deserialize(txBuffer);
    const vMsg = originalV0.message;
    const altAccounts: AddressLookupTableAccount[] = [];
    for (const lookup of vMsg.addressTableLookups) {
      const result = await resolveConn.getAddressLookupTable(lookup.accountKey);
      if (result.value) altAccounts.push(result.value);
    }
    this.logger.log(
      `SolanaSponsor[prepareAndPartialSign]: v0 tx | ALTs=${vMsg.addressTableLookups.length} resolved=${altAccounts.length} sender=${vMsg.staticAccountKeys[0]?.toBase58().slice(0, 8)}... newFeePayer=${feePayerPk.toBase58().slice(0, 8)}...`,
    );
    const decompiledMsg = TransactionMessage.decompile(vMsg, { addressLookupTableAccounts: altAccounts });

    // Inline SOL top-up: fee payer sends lamports to sender in the same tx so the sender
    // can pay MagicBlock's shuttle rent (~2039280 lamports). Atomic — no wasted SOL if tx fails.
    const senderPk = vMsg.staticAccountKeys[0];
    const MIN_SENDER_LAMPORTS = 3_000_000;
    const senderBalance = await resolveConn.getBalance(senderPk);
    const topUpLamports = Math.max(0, MIN_SENDER_LAMPORTS - senderBalance);
    const prefundIxs: ReturnType<typeof SystemProgram.transfer>[] = [];
    if (topUpLamports > 0) {
      prefundIxs.push(
        SystemProgram.transfer({ fromPubkey: feePayerPk, toPubkey: senderPk, lamports: topUpLamports }),
      );
      this.logger.log(
        `SolanaSponsor[prepareAndPartialSign]: sender has ${senderBalance} lamports — inline top-up +${topUpLamports} lamports`,
      );
    } else {
      this.logger.log(`SolanaSponsor[prepareAndPartialSign]: sender has ${senderBalance} lamports — no top-up needed`);
    }

    // Rebuild as v0 (keeping ALTs compressed) — stays ~750b instead of ~1210b legacy expansion,
    // leaving room for the Loofta fee instruction appended after this.
    const v0Msg = new TransactionMessage({
      payerKey: feePayerPk,
      recentBlockhash: blockhash,
      instructions: [...prefundIxs, ...decompiledMsg.instructions],
    }).compileToV0Message(altAccounts);
    const v0Tx = new VersionedTransaction(v0Msg);
    const ser = v0Tx.serialize();
    this.logger.log(
      `SolanaSponsor[prepareAndPartialSign]: rebuilt as v0 | ${ser.length}b topUp=${topUpLamports} blockhash=${blockhash.slice(0, 8)}... (unsigned, countersign after user)`,
    );
    return {
      transactionBase64: Buffer.from(ser).toString('base64'),
      recentBlockhash: blockhash,
      lastValidBlockHeight,
      topUpLamports,
    };
  }

  /**
   * Send SOL from fee payer to sender if their balance is below the threshold.
   * Returns how many lamports were sent (0 if sender already had enough).
   * Used on mainnet so the main payment tx needs no top-up ix → smaller tx → Loofta fee ix fits.
   */
  async prefundSenderSolIfNeeded(
    senderAddress: string,
    conn: Connection,
    minLamports = 3_000_000,
  ): Promise<number> {
    if (!this.feePayerKeypair) throw new Error('Fee payer not configured');
    const { PublicKey } = await import('@solana/web3.js');
    const senderPk = new PublicKey(senderAddress);
    const balance = await conn.getBalance(senderPk);
    if (balance >= minLamports) {
      this.logger.log(`SolanaSponsor[prefund]: sender ${senderAddress.slice(0, 8)}… has ${balance} lamports — no prefund needed`);
      return 0;
    }
    const topUp = minLamports - balance;
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = this.feePayerKeypair.publicKey;
    tx.add(SystemProgram.transfer({ fromPubkey: this.feePayerKeypair.publicKey, toPubkey: senderPk, lamports: topUp }));
    tx.sign(this.feePayerKeypair);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    this.logger.log(`SolanaSponsor[prefund]: sent +${topUp} lamports to ${senderAddress.slice(0, 8)}… sig=${sig.slice(0, 12)}…`);
    await this.waitUntilSignatureVisible(sig, 30_000, 400, 'prefund', conn);
    this.logger.log(`SolanaSponsor[prefund]: confirmed`);
    return topUp;
  }

  /**
   * Validate that the transaction uses our fee payer and does not transfer SOL from the fee payer.
   * Then sign with fee payer and broadcast with skipPreflight.
   *
   * Pass network: "devnet" to route the broadcast to the devnet RPC with skipPreflight.
   */
  async signAndBroadcast(
    serializedTransactionBase64: string,
    network?: string,
    userId?: string,
    claimId?: string,
    pajOrderId?: string,
    nearIntentsOrderId?: string,
    offrampRequestId?: string,
    giveawayId?: string,
  ): Promise<{ signature: string }> {
    if (!this.feePayerKeypair || !this.feePayerAddress) {
      throw new Error('Solana fee sponsorship is not configured');
    }

    const transactionBuffer = Buffer.from(serializedTransactionBase64, 'base64');
    const reqStart = Date.now();
    const isDevnet = network === 'devnet';
    const broadcastConn = isDevnet ? this.getConnectionForCluster('devnet') : this.connection;
    this.logger.log(
      `SolanaSponsor[sign-and-broadcast]: incoming bytes=${transactionBuffer.length} network=${network ?? 'mainnet'} rpc=${broadcastConn.rpcEndpoint}`,
    );

    // Before anything else: never pay the same ATA's rent twice. Runs ahead of the legacy/v0
    // split so a single call covers both encodings.
    await this.assertAtaCreationsAllowed(
      serializedTransactionBase64,
      broadcastConn,
      'sign-and-broadcast',
      userId,
      claimId,
      pajOrderId,
      nearIntentsOrderId,
      offrampRequestId,
      giveawayId,
    );

    let legacy: Transaction | null = null;
    try {
      legacy = Transaction.from(transactionBuffer);
    } catch {
      legacy = null;
    }

    // PER flow should stay legacy; try legacy path first.
    if (legacy) {
      if (!legacy.feePayer || legacy.feePayer.toBase58() !== this.feePayerAddress) {
        throw new Error('Invalid fee payer in transaction');
      }
      for (const ix of legacy.instructions) {
        if (ix.programId.equals(SystemProgram.programId) && ix.data.length > 0 && ix.data[0] === 2) {
          const sender = ix.keys[0]?.pubkey;
          if (sender?.toBase58() === this.feePayerAddress) {
            throw new Error('Transaction attempts to transfer SOL from fee payer');
          }
        }
      }
      // Strip CloseAccount instructions (SPL Token discriminator 0x09).
      // Prevents ATA-rent drain: attacker embeds CloseAccount to refund rent the fee payer paid.
      const before = legacy.instructions.length;
      legacy.instructions = legacy.instructions.filter(ix => !(ix.data.length >= 1 && ix.data[0] === 0x09));
      if (legacy.instructions.length < before) {
        this.logger.warn(`SolanaSponsor[sign-and-broadcast]: stripped ${before - legacy.instructions.length} CloseAccount instruction(s) — possible drain attempt`);
      }
      // Program whitelist: reject any instruction from a non-whitelisted program.
      // Also blocks System Program createAccount/createAccountWithSeed/transferWithSeed
      // FROM the fee payer (these drain SOL beyond the base tx fee).
      // ATA creation is only allowed for the USDC mint (prevents rent-drain on arbitrary tokens).
      for (const ix of legacy.instructions) {
        const prog = ix.programId.toBase58();
        if (!ALLOWED_SPONSOR_PROGRAMS.has(prog)) {
          this.logger.warn(`SolanaSponsor[sign-and-broadcast]: blocked disallowed program ${prog}`);
          throw new Error(`Transaction contains disallowed program: ${prog}`);
        }
        if (prog === SystemProgram.programId.toBase58() && ix.data.length >= 4) {
          const discriminator = Buffer.from(ix.data).readUInt32LE(0);
          // createAccount=0, createAccountWithSeed=3, transferWithSeed=11 — all fund new accounts FROM payer.
          // assign=1, assignWithSeed=10 — reassign the fee payer's own account to another program (no
          // lamports move, but hands it and its balance to whatever that program's logic allows).
          if ((discriminator === 0 || discriminator === 1 || discriminator === 3 || discriminator === 10 || discriminator === 11) &&
              ix.keys[0]?.pubkey.toBase58() === this.feePayerAddress) {
            throw new Error('Transaction attempts to create/fund/reassign an account from fee payer');
          }
        }
        if (prog === ATA_PROGRAM_ID) {
          const mint = ix.keys[3]?.pubkey?.toBase58();
          if (!mint || !USDC_MINT_SET.has(mint)) {
            this.logger.warn(`SolanaSponsor[sign-and-broadcast]: blocked ATA creation for non-USDC mint ${mint ?? 'undefined'}`);
            throw new Error('ATA creation only allowed for USDC');
          }
        }
        if (prog === TOKEN_PROGRAM_ID_STR) {
          const discriminator = ix.data[0];
          if (!TOKEN_INSTRUCTION_ALLOWLIST.has(discriminator)) {
            this.logger.warn(`SolanaSponsor[sign-and-broadcast]: blocked disallowed Token instruction discriminator=${discriminator}`);
            throw new Error('Transaction contains a disallowed token instruction');
          }
        }
      }
      legacy.partialSign(this.feePayerKeypair);
      const missingLegacySigners = legacy.signatures
        .filter((s) => !s.signature)
        .map((s) => s.publicKey.toBase58());
      if (missingLegacySigners.length > 0) {
        throw new Error(
          `Missing required signatures (legacy): ${missingLegacySigners.join(', ')}`,
        );
      }
      if (!legacy.verifySignatures()) {
        const signerState = legacy.signatures.map((s) => ({
          signer: s.publicKey.toBase58(),
          signed: Boolean(s.signature),
        }));
        throw new Error(
          `Legacy transaction signature verification failed before broadcast: ${JSON.stringify(signerState)}`,
        );
      }
      const sendT0 = Date.now();
      const sig = await broadcastConn.sendRawTransaction(
        legacy.serialize({ requireAllSignatures: false, verifySignatures: false }),
        {
          skipPreflight: isDevnet,
          maxRetries: 3,
          preflightCommitment: 'confirmed',
        },
      );
      this.logger.log(
        `SolanaSponsor[sign-and-broadcast]: legacy sendRawTransaction done in ${Date.now() - sendT0}ms sig=${sig.slice(0, 12)}...`,
      );
      await this.waitUntilSignatureVisible(sig, 12_000, 400, 'sign-and-broadcast:legacy', broadcastConn).catch((e) => {
        this.logger.warn(
          `SolanaSponsor: signature ${sig.slice(0, 12)}... not yet visible after short wait (${String(
            (e as Error)?.message ?? e,
          )}). Returning signature immediately.`,
        );
      });
      this.logger.log(`SolanaSponsor[sign-and-broadcast]: legacy total ${Date.now() - reqStart}ms`);
      return { signature: sig };
    }

    // Fallback for non-PER flows that are truly versioned.
    const versioned = VersionedTransaction.deserialize(transactionBuffer);
    const message = versioned.message;
    const accountKeys = message.getAccountKeys().staticAccountKeys;

    const feePayerInTx = accountKeys[0];
    if (!feePayerInTx || feePayerInTx.toBase58() !== this.feePayerAddress) {
      throw new Error('Invalid fee payer in transaction');
    }
    const systemProgramId = SystemProgram.programId.toBase58();
    for (const ix of message.compiledInstructions) {
      const programId = accountKeys[ix.programIdIndex];
      if (programId?.toBase58() === systemProgramId && ix.data[0] === 2) {
        const senderIndex = ix.accountKeyIndexes[0];
        const sender = accountKeys[senderIndex];
        if (sender?.toBase58() === this.feePayerAddress) {
          throw new Error('Transaction attempts to transfer SOL from fee payer');
        }
      }
    }
    // Program whitelist + ATA-mint guard (v0 path).
    for (const ix of message.compiledInstructions) {
      const prog = accountKeys[ix.programIdIndex]?.toBase58();
      if (!prog || !ALLOWED_SPONSOR_PROGRAMS.has(prog)) {
        this.logger.warn(`SolanaSponsor[sign-and-broadcast]: blocked disallowed program (v0) ${prog}`);
        throw new Error(`Transaction contains disallowed program: ${prog}`);
      }
      if (prog === systemProgramId && ix.data.length >= 4) {
        const discriminator = Buffer.from(ix.data).readUInt32LE(0);
        if ((discriminator === 0 || discriminator === 1 || discriminator === 3 || discriminator === 10 || discriminator === 11) &&
            accountKeys[ix.accountKeyIndexes[0]]?.toBase58() === this.feePayerAddress) {
          throw new Error('Transaction attempts to create/fund/reassign an account from fee payer');
        }
      }
      if (prog === ATA_PROGRAM_ID) {
        const mint = accountKeys[ix.accountKeyIndexes[3]]?.toBase58();
        if (!mint || !USDC_MINT_SET.has(mint)) {
          this.logger.warn(`SolanaSponsor[sign-and-broadcast]: blocked ATA creation for non-USDC mint (v0) ${mint ?? 'undefined'}`);
          throw new Error('ATA creation only allowed for USDC');
        }
      }
      if (prog === TOKEN_PROGRAM_ID_STR) {
        const discriminator = ix.data[0];
        if (!TOKEN_INSTRUCTION_ALLOWLIST.has(discriminator)) {
          this.logger.warn(`SolanaSponsor[sign-and-broadcast]: blocked disallowed Token instruction discriminator (v0)=${discriminator}`);
          throw new Error('Transaction contains a disallowed token instruction');
        }
      }
    }
    versioned.sign([this.feePayerKeypair]);
    const missingV0Signers = versioned.signatures
      .map((sigBytes, idx) => ({ idx, hasSig: sigBytes.some((b) => b !== 0) }))
      .filter((x) => !x.hasSig)
      .map((x) => accountKeys[x.idx]?.toBase58?.() || `signer_index_${x.idx}`);
    if (missingV0Signers.length > 0) {
      throw new Error(`Missing required signatures (v0): ${missingV0Signers.join(', ')}`);
    }
    // VersionedTransaction does not expose verifySignatures() in @solana/web3.js v1.95+.
    // The missing-signer check above is sufficient; skip redundant call to avoid TS error.
    const sendT0 = Date.now();
    const sig = await broadcastConn.sendRawTransaction(versioned.serialize(), {
      skipPreflight: isDevnet,
      maxRetries: 3,
      preflightCommitment: 'confirmed',
    });
    this.logger.log(
      `SolanaSponsor[sign-and-broadcast]: v0 sendRawTransaction done in ${Date.now() - sendT0}ms sig=${sig.slice(0, 12)}...`,
    );
    await this.waitUntilSignatureVisible(sig, 12_000, 400, 'sign-and-broadcast:v0', broadcastConn).catch((e) => {
      this.logger.warn(
        `SolanaSponsor: signature ${sig.slice(0, 12)}... not yet visible after short wait (${String(
          (e as Error)?.message ?? e,
        )}). Returning signature immediately.`,
      );
    });
    this.logger.log(`SolanaSponsor[sign-and-broadcast]: v0 total ${Date.now() - reqStart}ms`);
    return { signature: sig };
  }

  /**
   * Mainnet path: resolve ALTs and convert a v0 MagicBlock transaction to legacy format so
   * Privy's embedded wallet can sign it without calling prepareTransaction to look up tables.
   * Does NOT inject our fee payer — Privy's gas sponsorship covers the tx fee on mainnet.
   */
  async convertV0ToLegacy(serializedBase64: string, conn?: Connection): Promise<{ transactionBase64: string }> {
    const txBuffer = Buffer.from(serializedBase64, 'base64');
    // Already legacy — nothing to do.
    try {
      Transaction.from(txBuffer);
      return { transactionBase64: serializedBase64 };
    } catch {
      // fall through to v0 handling
    }
    const resolveConn = conn ?? this.connection;
    const v0 = VersionedTransaction.deserialize(txBuffer);
    const vMsg = v0.message;
    const altAccounts: AddressLookupTableAccount[] = [];
    for (const lookup of vMsg.addressTableLookups) {
      const result = await resolveConn.getAddressLookupTable(lookup.accountKey);
      if (result.value) altAccounts.push(result.value);
    }
    this.logger.log(
      `SolanaSponsor[convertV0ToLegacy]: resolved ALTs=${altAccounts.length}/${vMsg.addressTableLookups.length}`,
    );
    const decompiledMsg = TransactionMessage.decompile(vMsg, { addressLookupTableAccounts: altAccounts });
    const legacyMsg = new TransactionMessage({
      payerKey: vMsg.staticAccountKeys[0],
      recentBlockhash: decompiledMsg.recentBlockhash,
      instructions: decompiledMsg.instructions,
    }).compileToLegacyMessage();
    const legacyTx = Transaction.populate(legacyMsg);
    const ser = legacyTx.serialize({ requireAllSignatures: false, verifySignatures: false });
    this.logger.log(`SolanaSponsor[convertV0ToLegacy]: v0→legacy ${ser.length}b`);
    return { transactionBase64: Buffer.from(ser).toString('base64') };
  }

  /**
   * Countersign a user-signed MagicBlock PER transaction with our fee payer and broadcast.
   *
   * Unlike signAndBroadcast, this allows SystemProgram.transfer FROM the fee payer (needed for
   * the shuttle SOL top-up prepended by prepareAndPartialSignTransaction). The total SOL the
   * fee payer can transfer is capped at 5_000_000 lamports (0.005 SOL) to prevent abuse.
   */
  async signAndBroadcastPER(
    userSignedTxBase64: string,
    conn?: Connection,
    userId?: string,
    claimId?: string,
  ): Promise<{ signature: string }> {
    const broadcastConn = conn ?? this.connection;
    const transactionBuffer = Buffer.from(userSignedTxBase64, 'base64');
    const reqStart = Date.now();
    this.logger.log(
      `SolanaSponsor[sign-and-broadcast-per]: incoming bytes=${transactionBuffer.length} rpc=${broadcastConn.rpcEndpoint}`,
    );

    // Gasless path: fee payer is MagicBlock's sponsor (not our keypair). Just broadcast.
    const feePayerInTx = (() => {
      try { return Transaction.from(transactionBuffer).feePayer?.toBase58(); } catch { /* v0 */ }
      try { return VersionedTransaction.deserialize(transactionBuffer).message.staticAccountKeys[0]?.toBase58(); } catch { /* ignore */ }
      return undefined;
    })();
    if (!this.feePayerAddress || feePayerInTx !== this.feePayerAddress) {
      this.logger.log(`SolanaSponsor[sign-and-broadcast-per]: gasless path — feePayer=${feePayerInTx?.slice(0, 8) ?? 'unknown'}… is not ours, broadcasting directly`);
      let serialized: Uint8Array;
      try { serialized = Transaction.from(transactionBuffer).serialize({ requireAllSignatures: false, verifySignatures: false }); }
      catch { serialized = VersionedTransaction.deserialize(transactionBuffer).serialize(); }
      const sig = await broadcastConn.sendRawTransaction(serialized, { skipPreflight: false, maxRetries: 3, preflightCommitment: 'confirmed' });
      this.logger.log(`SolanaSponsor[sign-and-broadcast-per]: gasless broadcast sig=${sig.slice(0, 12)}… total=${Date.now() - reqStart}ms`);
      await this.waitUntilSignatureVisible(sig, 12_000, 400, 'sign-and-broadcast-per:gasless', broadcastConn).catch(() => {});
      return { signature: sig };
    }

    // Past the gasless early-return our fee payer is the one paying, so the same
    // never-pay-rent-twice rule as sign-and-broadcast applies here too.
    await this.assertAtaCreationsAllowed(
      userSignedTxBase64,
      broadcastConn,
      'sign-and-broadcast-per',
      userId,
      claimId,
    );

    if (!this.feePayerKeypair) {
      throw new Error('Solana fee sponsorship is not configured');
    }

    // Allow SOL transfers from fee payer only up to the shuttle top-up cap (0.005 SOL).
    const MAX_TOPUP_LAMPORTS = 5_000_000;

    let legacy: Transaction | null = null;
    try { legacy = Transaction.from(transactionBuffer); } catch { legacy = null; }

    let serializedForBroadcast: Uint8Array;

    if (legacy) {
      if (!legacy.feePayer || legacy.feePayer.toBase58() !== this.feePayerAddress) {
        throw new Error('Invalid fee payer in PER transaction');
      }
      // Same disallowed-program / CloseAccount-strip / USDC-only-ATA guard as the generic
      // sign-and-broadcast path — this endpoint used to skip all of it and only cap the SOL
      // top-up amount, which still let a caller get the fee payer to sponsor creating a token
      // account (or invoking any other whitelisted-looking instruction) with zero restriction on
      // which program/mint/owner was involved.
      const beforeStrip = legacy.instructions.length;
      legacy.instructions = legacy.instructions.filter(ix => !(ix.data.length >= 1 && ix.data[0] === 0x09));
      if (legacy.instructions.length < beforeStrip) {
        this.logger.warn(`SolanaSponsor[sign-and-broadcast-per]: stripped ${beforeStrip - legacy.instructions.length} CloseAccount instruction(s) — possible drain attempt`);
      }
      for (const ix of legacy.instructions) {
        const prog = ix.programId.toBase58();
        if (!ALLOWED_SPONSOR_PROGRAMS.has(prog)) {
          this.logger.warn(`SolanaSponsor[sign-and-broadcast-per]: blocked disallowed program ${prog}`);
          throw new Error(`PER transaction contains disallowed program: ${prog}`);
        }
        if (prog === ATA_PROGRAM_ID) {
          const mint = ix.keys[3]?.pubkey?.toBase58();
          if (!mint || !USDC_MINT_SET.has(mint)) {
            this.logger.warn(`SolanaSponsor[sign-and-broadcast-per]: blocked ATA creation for non-USDC mint ${mint ?? 'undefined'}`);
            throw new Error('ATA creation only allowed for USDC');
          }
        }
        if (prog === TOKEN_PROGRAM_ID_STR) {
          const discriminator = ix.data[0];
          if (!TOKEN_INSTRUCTION_ALLOWLIST.has(discriminator)) {
            this.logger.warn(`SolanaSponsor[sign-and-broadcast-per]: blocked disallowed Token instruction discriminator=${discriminator}`);
            throw new Error('PER transaction contains a disallowed token instruction');
          }
        }
        // The lamport-cap loop below only inspects plain Transfer (discriminator 2) — without this,
        // createAccount/assign/createAccountWithSeed/assignWithSeed/transferWithSeed from the fee
        // payer would sail through uncapped, since none of them are discriminator 2.
        if (prog === SystemProgram.programId.toBase58() && ix.data.length >= 4) {
          const discriminator = Buffer.from(ix.data).readUInt32LE(0);
          if ((discriminator === 0 || discriminator === 1 || discriminator === 3 || discriminator === 10 || discriminator === 11) &&
              ix.keys[0]?.pubkey.toBase58() === this.feePayerAddress) {
            throw new Error('PER transaction attempts to create/fund/reassign an account from fee payer');
          }
        }
      }
      let totalFeePayerLamports = 0;
      for (const ix of legacy.instructions) {
        if (ix.programId.equals(SystemProgram.programId) && ix.data.length >= 12 && ix.data.readUInt32LE(0) === 2) {
          const sender = ix.keys[0]?.pubkey;
          if (sender?.toBase58() === this.feePayerAddress) {
            const lamports = Number(ix.data.readBigUInt64LE(4));
            totalFeePayerLamports += lamports;
            if (totalFeePayerLamports > MAX_TOPUP_LAMPORTS) {
              throw new Error(`PER transaction attempts to transfer too much SOL from fee payer (${totalFeePayerLamports} lamports)`);
            }
          }
        }
      }
      legacy.partialSign(this.feePayerKeypair);
      if (!legacy.verifySignatures()) {
        const signerState = legacy.signatures.map((s) => ({
          signer: s.publicKey.toBase58().slice(0, 8) + '...',
          signed: Boolean(s.signature),
        }));
        throw new Error(`PER transaction signature verification failed: ${JSON.stringify(signerState)}`);
      }
      serializedForBroadcast = legacy.serialize({ requireAllSignatures: false, verifySignatures: false });
    } else {
      // v0 transaction (produced by prepareAndPartialSignTransaction for MagicBlock ALT-based txs)
      const versioned = VersionedTransaction.deserialize(transactionBuffer);
      const staticKeys = versioned.message.staticAccountKeys;
      if (!staticKeys[0] || staticKeys[0].toBase58() !== this.feePayerAddress) {
        throw new Error('Invalid fee payer in PER v0 transaction');
      }
      // Same disallowed-program / USDC-only-ATA guard as the legacy branch above — see that
      // comment for why this was missing entirely before.
      for (const ix of versioned.message.compiledInstructions) {
        const prog = staticKeys[ix.programIdIndex]?.toBase58();
        if (!prog || !ALLOWED_SPONSOR_PROGRAMS.has(prog)) {
          this.logger.warn(`SolanaSponsor[sign-and-broadcast-per]: blocked disallowed program (v0) ${prog}`);
          throw new Error(`PER v0 transaction contains disallowed program: ${prog}`);
        }
        if (prog === ATA_PROGRAM_ID) {
          const mint = staticKeys[ix.accountKeyIndexes[3]]?.toBase58();
          if (!mint || !USDC_MINT_SET.has(mint)) {
            this.logger.warn(`SolanaSponsor[sign-and-broadcast-per]: blocked ATA creation for non-USDC mint (v0) ${mint ?? 'undefined'}`);
            throw new Error('ATA creation only allowed for USDC');
          }
        }
        // Token-instruction allowlist — v0 compiled instructions are positional/immutable so a
        // CloseAccount (or Approve/SetAuthority/etc.) can't be stripped in place like the legacy
        // branch does; reject the whole transaction outright instead.
        if (prog === TOKEN_PROGRAM_ID_STR) {
          const discriminator = ix.data[0];
          if (!TOKEN_INSTRUCTION_ALLOWLIST.has(discriminator)) {
            this.logger.warn(`SolanaSponsor[sign-and-broadcast-per]: blocked disallowed Token instruction (v0) discriminator=${discriminator} — possible drain attempt`);
            throw new Error('PER v0 transaction contains a disallowed token instruction');
          }
        }
        // Same reasoning as the legacy branch: the lamport-cap loop below only inspects plain
        // Transfer (discriminator 2), so createAccount/assign/createAccountWithSeed/
        // assignWithSeed/transferWithSeed from the fee payer must be blocked here explicitly.
        if (prog === SystemProgram.programId.toBase58()) {
          const discriminator = ix.data[0];
          const senderIdx = ix.accountKeyIndexes[0];
          const sender = staticKeys[senderIdx];
          if ((discriminator === 0 || discriminator === 1 || discriminator === 3 || discriminator === 10 || discriminator === 11) &&
              sender?.toBase58() === this.feePayerAddress) {
            throw new Error('PER v0 transaction attempts to create/fund/reassign an account from fee payer');
          }
        }
      }
      let totalFeePayerLamports = 0;
      for (const ix of versioned.message.compiledInstructions) {
        const programId = staticKeys[versioned.message.staticAccountKeys.findIndex((_, i) => i === ix.programIdIndex)];
        if (programId?.toBase58() === SystemProgram.programId.toBase58() && ix.data[0] === 2) {
          const senderIdx = ix.accountKeyIndexes[0];
          const sender = staticKeys[senderIdx];
          if (sender?.toBase58() === this.feePayerAddress) {
            const view = new DataView(ix.data.buffer, ix.data.byteOffset);
            const lamports = Number(view.getBigUint64(4, true));
            totalFeePayerLamports += lamports;
            if (totalFeePayerLamports > MAX_TOPUP_LAMPORTS) {
              throw new Error(`PER v0 transaction attempts to transfer too much SOL from fee payer (${totalFeePayerLamports} lamports)`);
            }
          }
        }
      }
      versioned.sign([this.feePayerKeypair]);
      serializedForBroadcast = versioned.serialize();
    }

    const sendT0 = Date.now();
    const sig = await broadcastConn.sendRawTransaction(
      serializedForBroadcast,
      { skipPreflight: false, maxRetries: 3, preflightCommitment: 'confirmed' },
    );
    this.logger.log(
      `SolanaSponsor[sign-and-broadcast-per]: sendRawTransaction done in ${Date.now() - sendT0}ms sig=${sig.slice(0, 12)}...`,
    );
    await this.waitUntilSignatureVisible(sig, 12_000, 400, 'sign-and-broadcast-per', broadcastConn).catch((e) => {
      const msg = String((e as Error)?.message ?? e);
      if (msg.includes('failed on-chain')) throw e; // on-chain failure must propagate
      this.logger.warn(
        `SolanaSponsor: PER sig ${sig.slice(0, 12)}... not yet visible after short wait (${msg}). Returning immediately.`,
      );
    });
    this.logger.log(`SolanaSponsor[sign-and-broadcast-per]: total ${Date.now() - reqStart}ms`);
    return { signature: sig };
  }

  /**
   * Send a small SOL amount from the fee payer to the given wallet.
   * Used to top up a sender's SOL balance before a MagicBlock private transfer when they are below
   * the shuttle rent threshold. No user signature required — fee payer signs entirely server-side.
   */
  async sendSolTopup(recipientWallet: string, lamports: number): Promise<{ signature: string }> {
    if (!this.feePayerKeypair) {
      throw new Error('Fee payer not configured — cannot send SOL top-up');
    }
    const { PublicKey } = await import('@solana/web3.js');
    const recipient = new PublicKey(recipientWallet);
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');

    const tx = new Transaction({
      recentBlockhash: blockhash,
      feePayer: this.feePayerKeypair.publicKey,
    }).add(
      SystemProgram.transfer({
        fromPubkey: this.feePayerKeypair.publicKey,
        toPubkey: recipient,
        lamports,
      }),
    );

    tx.sign(this.feePayerKeypair);
    const sig = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    this.logger.log(`SolanaSponsor[sol-topup]: sent ${lamports} lamports to ${recipientWallet.slice(0, 8)}... sig=${sig.slice(0, 12)}... lastValidBlockHeight=${lastValidBlockHeight}`);
    await this.waitUntilSignatureVisible(sig, 60_000, 500, 'sol-topup');
    this.logger.log(`SolanaSponsor[sol-topup]: confirmed | sig=${sig.slice(0, 12)}...`);
    return { signature: sig };
  }
}
