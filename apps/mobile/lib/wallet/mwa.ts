/**
 * Mobile Wallet Adapter — talks directly to the Seeker's own wallet (Seed Vault) over the MWA
 * protocol. This is the ONLY signer in the app: no Privy embedded wallet anywhere. Privy is used
 * purely for session/identity (see lib/auth/useSeekerLogin.ts), verified from a signature this
 * module produces — the private key never leaves the device's Seed Vault.
 */
import { transact, type Web3MobileWallet } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import * as SecureStore from 'expo-secure-store';
import nacl from 'tweetnacl';
import { Buffer } from 'buffer';

const AUTH_TOKEN_KEY = 'mwa_auth_token';
const APP_IDENTITY = { name: 'Loofta', uri: 'https://pay.loofta.xyz', icon: 'favicon.ico' } as const;

/** MWA account addresses are base64-encoded raw pubkey bytes, not the usual base58 string. */
function toBase58(mwaAddress: string): string {
  return new PublicKey(Buffer.from(mwaAddress, 'base64')).toBase58();
}

interface Connected {
  wallet: Web3MobileWallet;
  mwaAddress: string; // base64, for wallet API calls (signMessages addresses field)
  base58Address: string; // for app/backend use
}

/**
 * Opens a wallet session — reauthorizes silently with a cached token when possible (no prompt),
 * falls back to a full authorize (shows the Seed Vault prompt) otherwise. Every call re-persists
 * the token since Seed Vault may rotate it on reauthorize.
 */
async function withWallet<T>(fn: (c: Connected) => Promise<T>): Promise<T> {
  return transact(async (wallet) => {
    const stored = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
    let authResult = null;
    if (stored) {
      try {
        authResult = await wallet.reauthorize({ auth_token: stored, identity: APP_IDENTITY });
      } catch {
        authResult = null; // token expired/revoked — fall through to a fresh authorize
      }
    }
    if (!authResult) {
      authResult = await wallet.authorize({ chain: 'solana:mainnet', identity: APP_IDENTITY });
    }
    await SecureStore.setItemAsync(AUTH_TOKEN_KEY, authResult.auth_token);

    const mwaAddress = authResult.accounts[0].address;
    return fn({ wallet, mwaAddress, base58Address: toBase58(mwaAddress) });
  });
}

/** Connects (or silently resumes a connection to) the Seeker wallet. Returns its Solana address. */
export async function connectSeekerWallet(): Promise<{ base58Address: string }> {
  return withWallet(async ({ base58Address }) => ({ base58Address }));
}

/**
 * Connects the Seeker wallet and signs a message derived from its address, in one wallet
 * session — used for the SIWS login flow, where the message text (from Privy's generateMessage)
 * can only be built once the address is known. Doing this as a single transact() call, instead
 * of connect-then-sign as two separate calls, avoids a second Seed Vault round-trip for what's
 * conceptually one "log in" action.
 *
 * Two non-obvious requirements here, both confirmed against Privy's official MWA recipe
 * (docs.privy.io/recipes/solana/adding-solana-mwa):
 *   1. Privy's login() expects the signature **base64**-encoded, not base58 — despite base58
 *      being the convention everywhere else in this codebase (PublicKey.toBase58() etc.).
 *      Sending base58 doesn't error on encoding, it just silently fails server-side signature
 *      verification and comes back as a generic "invalid siws message and/or nonce".
 *   2. wallet.signMessages() isn't guaranteed to return a bare signature — some wallets return
 *      `message_bytes ++ signature_bytes` per the MWA wire protocol (see this same slice in
 *      @solana-mobile/mobile-wallet-adapter-protocol's own signInFallback helper). Slicing the
 *      last 64 bytes is a no-op when the wallet already returns a bare signature, so it's safe
 *      to always do.
 */
export async function connectAndSignMessage(
  buildMessage: (base58Address: string) => Promise<string>,
): Promise<{ base58Address: string; message: string; signatureBase64: string }> {
  return withWallet(async ({ wallet, mwaAddress, base58Address }) => {
    const message = await buildMessage(base58Address);
    const payload = new TextEncoder().encode(message);
    const [signedPayload] = await wallet.signMessages({ addresses: [mwaAddress], payloads: [payload] });
    const signature = signedPayload.slice(signedPayload.length - 64);

    if (!nacl.sign.detached.verify(payload, signature, new PublicKey(base58Address).toBytes())) {
      console.warn('[mwa] Signed message failed local verification — signature extraction may be wrong for this wallet.');
    }

    return { base58Address, message, signatureBase64: Buffer.from(signature).toString('base64') };
  });
}

/**
 * Signs and submits one base64-encoded VersionedTransaction (as returned by the backend's
 * initiatePurchase/buyGift/withdraw endpoints) via the Seeker wallet, and returns the tx
 * signature — the same string the backend's confirm endpoints expect (feeTxHash/senderTxHash).
 * One call per transaction, matching the web flow's sequential sign-then-confirm-then-sign-next
 * pattern (fee tx and the MagicBlock transfer can't be combined into one transaction).
 */
export async function signAndSendTransactionWithSeeker(base64Tx: string): Promise<string> {
  return withWallet(async ({ wallet }) => {
    const tx = VersionedTransaction.deserialize(Buffer.from(base64Tx, 'base64'));
    const [signature] = await wallet.signAndSendTransactions({ transactions: [tx] });
    return signature;
  });
}

/** Revokes the wallet session — call on logout. */
export async function disconnectSeekerWallet(): Promise<void> {
  const stored = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
  if (stored) {
    try {
      await transact(async (wallet) => wallet.deauthorize({ auth_token: stored }));
    } catch {
      // best-effort — clear the local token regardless
    }
  }
  await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
}
