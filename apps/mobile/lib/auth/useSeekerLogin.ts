import { useLoginWithSiws, usePrivy } from '@privy-io/expo';
import { useState } from 'react';
import { connectAndSignMessage, disconnectSeekerWallet } from '../wallet/mwa';
import { ensureProfile } from '../api/users';
import { clearCachedSeekerIdentity, updateCachedSkrDomain } from '../storage/seekerIdentity';
import { clearCachedWalletBalances } from '../storage/walletBalances';

const DOMAIN = 'pay.loofta.xyz';
const URI = 'https://pay.loofta.xyz';

export type SeekerLoginStatus = 'idle' | 'connecting' | 'verifying' | 'error';

/**
 * "Log in" on mobile means connecting the Seeker's own wallet — no email/OTP, no Privy embedded
 * wallet. generateMessage()/login() are wallet-agnostic on Privy's side (just a message to sign
 * and a signature to verify), so the Seeker wallet can be the entire credential: Privy still
 * issues the session the backend already trusts, but the private key never leaves Seed Vault.
 */
export function useSeekerLogin() {
  const { generateMessage, login } = useLoginWithSiws();
  const { getAccessToken } = usePrivy();
  const [status, setStatus] = useState<SeekerLoginStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const loginWithSeeker = async () => {
    setError(null);
    setStatus('connecting');
    try {
      const { message, signatureBase64, label } = await connectAndSignMessage(async (base58Address) => {
        const { message } = await generateMessage({
          wallet: { address: base58Address },
          from: { domain: DOMAIN, uri: URI },
        });
        return message;
      });

      // The wallet already reports its own label (the Seeker ID, when claimed) right here in the
      // connect handshake — cache it immediately instead of waiting on a separate backend lookup.
      void updateCachedSkrDomain(label);

      // Temporary diagnostics for the "invalid siws message and/or nonce" investigation — remove
      // once login is confirmed working. Message content is safe to log (no secrets); it's the
      // exact same string Privy generated and will re-verify against.
      console.log('[siws] message:\n' + message);
      console.log('[siws] signature (base64, len=' + signatureBase64.length + '):', signatureBase64);

      setStatus('verifying');
      await login({
        signature: signatureBase64,
        message,
        // Matches Privy's documented Expo/SIWS call shape (docs.privy.io/guide/expo/authentication/siws).
        // Purely descriptive metadata per Privy's own schema (optional, nullable, not part of
        // signature/nonce verification) — included for parity with the docs, not expected to be
        // the fix for an "invalid siws message and/or nonce" rejection.
        wallet: { walletClientType: 'seed_vault', connectorType: 'solana_mobile_wallet_adapter' },
      });

      // Idempotent — creates the app_users row on first login (see UsersService.ensureAppUser).
      // Best-effort: a hiccup here shouldn't strand the user on an error screen after a
      // successful wallet login, since the core buy/history/redeem flows don't depend on it.
      try {
        const accessToken = await getAccessToken();
        await ensureProfile(accessToken);
      } catch (e) {
        console.warn('[login] ensureProfile failed (non-fatal):', e);
      }

      setStatus('idle');
    } catch (e: any) {
      // Dumped as a single string, not an object — the RN DevTools console only shows a
      // collapsed "Object" reference for console.error(label, obj) and it can't be expanded
      // from a pasted screenshot/log.
      const dump = [
        `name=${e?.name}`,
        `message=${e?.message}`,
        `code=${e?.code}`,
        `status=${e?.status}`,
        `error=${JSON.stringify(e?.error)}`,
        `response=${JSON.stringify(e?.response)}`,
        `ownKeys=${Object.getOwnPropertyNames(e ?? {}).join(',')}`,
        `full=${(() => { try { return JSON.stringify(e); } catch { return '<unserializable>'; } })()}`,
      ].join(' | ');
      console.error('[siws] login failed: ' + dump);
      setError(e?.message ?? 'Could not connect wallet');
      setStatus('error');
    }
  };

  return { loginWithSeeker, status, error };
}

export async function logoutSeeker(logout: () => Promise<void>) {
  await disconnectSeekerWallet();
  await clearCachedSeekerIdentity();
  await clearCachedWalletBalances();
  await logout();
}
