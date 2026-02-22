/**
 * Claim flow adapted from privacy-hack lib/sponsor/prepareAndSubmitClaim.ts.
 * Uses our send_payment_links (via claimAdapter) and our vault-crypto; rest from privacy-hack (depositBuilder, withdrawSPL).
 * Sender pays Privacy Cash fees so recipient gets full link.amount; optional SOL tx funds burner for claim gas.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { WasmFactory } from '@lightprotocol/hasher.rs';

const RELAYER_API_URL =
  process.env.NEXT_PUBLIC_RELAYER_API_URL ?? 'https://api3.privacycash.org';

import { buildDepositSPLTransaction } from './depositBuilder';
import { TOKEN_MINTS, TokenType } from './tokens';
import { getCircuitBasePathCached } from './circuitPath';
import {
  createActivityForLink,
  getActivityForLink,
  getLinkAmountForVerification,
  updateActivityStatusForLink,
} from './claimAdapter';
import {
  generatePassphrase,
  encryptWithPassphrase,
  encryptWithSessionSignature,
} from './vault-crypto';
import { importEsm } from './esmLoader';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getPrivacyCashFeeConfig,
  computePrivateGrossFromRecipient,
  BURNER_SOL_LAMPORTS,
} from './privacy-cash-fees';

const BASE_FEE_LAMPORTS = 5000;

function createStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    get length() {
      return map.size;
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    clear: () => {
      map.clear();
    },
  };
}

async function relayDepositToIndexer(
  signedTransaction: string,
  senderAddress: string,
  mintAddress: string,
): Promise<string> {
  const response = await fetch(`${RELAYER_API_URL}/deposit/spl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedTransaction, senderAddress, mintAddress }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Relay failed: ${text}`);
  }
  const result = (await response.json()) as { signature: string };
  return result.signature;
}

export interface PrepareClaimForLinkParams {
  connection: Connection;
  senderPublicKey: PublicKey;
  sessionSignature: Uint8Array;
  amount: number;
  token: TokenType;
  message?: string | null;
  /** When set, this key pays network fees (sponsor); user SOL balance check is skipped. */
  sponsorPublicKey?: PublicKey | null;
  /** When true, skip user SOL check (e.g. frontend sends tx and Privy sponsors fees). */
  skipUserSolCheck?: boolean;
  /** Use this burner instead of generating a new one (single burner = same as link deposit address). */
  existingBurnerSecretKey?: Uint8Array;
}

export interface PrepareClaimForLinkResult {
  activityId: string;
  unsignedDepositTx: string;
  lastValidBlockHeight: number;
  passphrase: string;
  burnerAddress: string;
  /** Privacy Cash fees (sender pays so recipient gets full amount). */
  feeUsdc: number;
  /** Total USDC sender deposits (recipient amount + fees). */
  totalDepositUsdc: number;
  /** Unsigned SOL transfer (sender → burner) for claim gas; base64. */
  unsignedSolTx?: string;
}

/** Same logic as privacy-hack prepareClaim; stores in send_payment_links via adapter. */
export async function prepareClaimForLink(
  supabase: SupabaseClient,
  linkId: string,
  params: PrepareClaimForLinkParams,
): Promise<PrepareClaimForLinkResult> {
  const { connection, senderPublicKey, sessionSignature, amount, token, message, sponsorPublicKey, skipUserSolCheck, existingBurnerSecretKey } =
    params;
  // amount = recipient amount (link.amount). Sender pays amount + PC fees.
  const feeConfig = await getPrivacyCashFeeConfig();
  if (amount < feeConfig.minimum_withdrawal_usdc) {
    throw new Error(
      `Private send minimum is ${feeConfig.minimum_withdrawal_usdc} USDC (Privacy Cash requirement). Got ${amount}`,
    );
  }
  const { grossBaseUnits, feeUsdc, grossUsdc } = computePrivateGrossFromRecipient(
    amount,
    feeConfig,
  );

  console.log(`[PrivateClaim] prepareClaimForLink START linkId=${linkId} recipientAmount=${amount} USDC feeUsdc=${feeUsdc.toFixed(4)} totalDeposit=${grossUsdc.toFixed(4)} baseUnits=${grossBaseUnits} burner=${existingBurnerSecretKey ? 'existing' : 'new'} sender=${senderPublicKey.toBase58().slice(0, 8)}...`);

  const burnerKeypair = existingBurnerSecretKey
    ? Keypair.fromSecretKey(existingBurnerSecretKey)
    : Keypair.generate();
  const passphrase = generatePassphrase();
  const burnerSecretKey = burnerKeypair.secretKey;
  const encryptedForReceiver = encryptWithPassphrase(burnerSecretKey, passphrase);
  const encryptedForSender = encryptWithSessionSignature(burnerSecretKey, sessionSignature);

  await createActivityForLink(supabase, linkId, {
    type: 'send_claim',
    sender_address: senderPublicKey.toBase58(),
    receiver_address: null,
    amount,
    token_address: TOKEN_MINTS[token].toBase58(),
    status: 'open',
    message: message ?? null,
    tx_hash: null,
    burner_address: burnerKeypair.publicKey.toBase58(),
    encrypted_for_receiver: encryptedForReceiver,
    encrypted_for_sender: encryptedForSender,
  });

  // Build deposit with USER as fee payer (same as privacy-hack) so the wallet can
  // simulate and display the tx. Do not pass sponsorPublicKey here.
  const storage = createStorage();
  const { transaction: depositTx, lastValidBlockHeight } = await buildDepositSPLTransaction({
    connection,
    userPublicKey: senderPublicKey,
    sessionSignature,
    baseUnits: grossBaseUnits,
    token,
    storage,
  });

  // User is always fee payer for the deposit tx (same as privacy-hack); check they have SOL.
  if (!skipUserSolCheck) {
    const feeCalculator = await connection.getFeeForMessage(depositTx.message, 'confirmed');
    const estimatedFeeLamports = feeCalculator.value ?? BASE_FEE_LAMPORTS;
    const userBalance = await connection.getBalance(senderPublicKey);
    if (userBalance < estimatedFeeLamports) {
      await updateActivityStatusForLink(supabase, linkId, 'cancelled');
      throw new Error(
        `Insufficient SOL for network fees. Need ${estimatedFeeLamports} lamports, have ${userBalance}`,
      );
    }
  }

  const unsignedDepositTx = Buffer.from(depositTx.serialize()).toString('base64');

  // Optional: unsigned SOL transfer so burner has gas for claim (0.0005 SOL to burner, not our fee payer).
  let unsignedSolTx: string | undefined;
  try {
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const msg = new TransactionMessage({
      payerKey: senderPublicKey,
      recentBlockhash: blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: senderPublicKey,
          toPubkey: burnerKeypair.publicKey,
          lamports: BURNER_SOL_LAMPORTS,
        }),
      ],
    }).compileToV0Message();
    const solTx = new VersionedTransaction(msg);
    unsignedSolTx = Buffer.from(solTx.serialize()).toString('base64');
  } catch (e) {
    console.warn('[PrivateClaim] Could not build SOL tx for burner gas:', (e as Error).message);
  }

  console.log(`[PrivateClaim] prepareClaimForLink DONE linkId=${linkId} recipientAmount=${amount} USDC totalDeposit=${grossUsdc} feeUsdc=${feeUsdc} burnerAddress=${burnerKeypair.publicKey.toBase58()} depositTxBuilt=OK`);

  return {
    activityId: linkId,
    unsignedDepositTx,
    lastValidBlockHeight,
    passphrase,
    burnerAddress: burnerKeypair.publicKey.toBase58(),
    feeUsdc,
    totalDepositUsdc: grossUsdc,
    unsignedSolTx,
  };
}

export interface SubmitClaimForLinkParams {
  connection: Connection;
  /** When frontend sends the tx, pass the signature here and omit signedDepositTx for the relay path. */
  signedDepositTx?: string;
  sessionSignature: Uint8Array;
  activityId: string;
  senderPublicKey: PublicKey;
  lastValidBlockHeight?: number;
  /** If set, skip relaying; use this as deposit signature (tx was already sent from frontend). */
  existingDepositSignature?: string;
  /** Optional: signed SOL transfer (sender → burner) for claim gas; submit after withdraw. */
  signedSolTx?: string;
}

export interface SubmitClaimForLinkResult {
  depositTx: string;
  withdrawTx: string;
  burnerAddress: string;
}

/** Same logic as privacy-hack submitClaim; reads from send_payment_links via adapter. */
export async function submitClaimForLink(
  supabase: SupabaseClient,
  params: SubmitClaimForLinkParams,
): Promise<SubmitClaimForLinkResult> {
  const {
    connection,
    signedDepositTx,
    sessionSignature,
    activityId,
    senderPublicKey,
    lastValidBlockHeight,
    existingDepositSignature,
    signedSolTx,
  } = params;

  if (lastValidBlockHeight != null) {
    const current = await connection.getBlockHeight('confirmed');
    if (current > lastValidBlockHeight) {
      throw new Error('Transaction expired. Please prepare again.');
    }
  }

  console.log(`[PrivateClaim] submitClaimForLink START activityId=${activityId} sender=${senderPublicKey.toBase58().slice(0, 8)}... existingDepositSignature=${!!existingDepositSignature}`);

  const activity = await getActivityForLink(supabase, activityId);
  if (!activity) throw new Error('Activity not found');
  if (activity.type !== 'send_claim') throw new Error('Not a claim link activity');
  if (activity.status !== 'open') throw new Error('Claim link already processed');
  if (!activity.burner_address || !activity.encrypted_for_sender) {
    throw new Error('Activity missing burner data');
  }
  if (activity.sender_address !== senderPublicKey.toBase58()) {
    throw new Error('Not authorized to submit this claim link');
  }

  const amountFromActivity = activity.amount; // recipient amount (link.amount)
  if (Number.isNaN(amountFromActivity) || amountFromActivity < 0.1) {
    throw new Error(`Invalid withdraw amount: ${amountFromActivity} USDC (link ${activityId})`);
  }

  const linkAmountNow = await getLinkAmountForVerification(supabase, activityId);
  if (Math.abs(linkAmountNow - amountFromActivity) > 0.000001) {
    throw new Error(
      `Amount mismatch: link.amount=${linkAmountNow} activity.amount=${amountFromActivity} (link ${activityId}). Aborting.`,
    );
  }
  // Withdraw gross so that after PC fees the burner receives link.amount.
  const feeConfig = await getPrivacyCashFeeConfig();
  const { grossBaseUnits } = computePrivateGrossFromRecipient(amountFromActivity, feeConfig);
  const linkBaseUnits = Math.floor(linkAmountNow * 1_000_000);
  console.log(`[PrivateClaim] AMOUNT_MATCH OK linkId=${activityId} recipientAmount=${amountFromActivity} USDC grossBaseUnits=${grossBaseUnits} (link.amount=${linkAmountNow}) proceeding`);

  const burnerAddress = new PublicKey(activity.burner_address);
  const mintAddress = TOKEN_MINTS.USDC;

  try {
    console.log(`[PrivateClaim] Relay START linkId=${activityId} amount=${amountFromActivity} USDC`);
    const depositSig = existingDepositSignature
      ? existingDepositSignature
      : await relayDepositToIndexer(
          signedDepositTx!,
          senderPublicKey.toBase58(),
          mintAddress.toBase58(),
        );
    console.log(`[PrivateClaim] Relay DONE linkId=${activityId} depositSig=${depositSig.slice(0, 16)}...`);

    await new Promise((r) => setTimeout(r, existingDepositSignature ? 5_000 : 15_000));

    console.log(`[PrivateClaim] Withdraw START linkId=${activityId} recipientAmount=${amountFromActivity} USDC grossBaseUnits=${grossBaseUnits} recipientBurner=${activity.burner_address}`);
    const privacycashUtils = await importEsm<{
      EncryptionService: new () => { deriveEncryptionKeyFromSignature(sig: Uint8Array): void };
      withdrawSPL: (opts: unknown) => Promise<{ tx: string }>;
    }>('privacycash/utils');
    const { EncryptionService, withdrawSPL } = privacycashUtils;
    const encryptionService = new EncryptionService();
    encryptionService.deriveEncryptionKeyFromSignature(sessionSignature);
    const lightWasm = await WasmFactory.getInstance();
    const storage = createStorage();

    const withdrawResult = await withdrawSPL({
      mintAddress,
      lightWasm,
      base_units: grossBaseUnits,
      connection,
      encryptionService,
      publicKey: senderPublicKey,
      recipient: burnerAddress,
      keyBasePath: getCircuitBasePathCached(),
      storage,
    });

    console.log(`[PrivateClaim] Withdraw DONE linkId=${activityId} amount=${amountFromActivity} USDC withdrawTx=${withdrawResult.tx}`);

    await updateActivityStatusForLink(supabase, activityId, 'open', { tx_hash: withdrawResult.tx });

    if (signedSolTx) {
      try {
        const solTxBuf = Buffer.from(signedSolTx, 'base64');
        const solTx = VersionedTransaction.deserialize(new Uint8Array(solTxBuf));
        const solSig = await connection.sendRawTransaction(solTx.serialize(), { skipPreflight: true });
        console.log(`[PrivateClaim] SOL tx for burner gas sent linkId=${activityId} sig=${solSig.slice(0, 16)}...`);
      } catch (e) {
        console.warn(`[PrivateClaim] Failed to send SOL tx for burner gas linkId=${activityId}:`, (e as Error).message);
      }
    }

    console.log(`[PrivateClaim] submitClaimForLink DONE linkId=${activityId} depositSig=${depositSig.slice(0, 16)}... withdrawTx=${withdrawResult.tx.slice(0, 16)}...`);
    return {
      depositTx: depositSig,
      withdrawTx: withdrawResult.tx,
      burnerAddress: burnerAddress.toBase58(),
    };
  } catch (error) {
    console.error(`[PrivateClaim] submitClaimForLink FAILED linkId=${activityId}`, error);
    await updateActivityStatusForLink(supabase, activityId, 'cancelled');
    throw error;
  }
}
