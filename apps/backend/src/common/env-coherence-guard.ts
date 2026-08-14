import { ConfigService } from '@nestjs/config';
import { Keypair } from '@solana/web3.js';

// bs58 may export default depending on bundler/runtime — same pattern as solana-sponsor.service.ts.
const bs58Module = require('bs58');
const bs58 = bs58Module?.default ?? bs58Module;

// Both of these are public identifiers (a Supabase project ref, a Solana public key), not
// secrets — safe to hardcode here as "the known production values" to check against.
const PRODUCTION_SUPABASE_REF = 'rfxzswjefgxwgmjvcckf';
const PRODUCTION_FEE_PAYER_PUBKEY = '5dCTWJj277c41ex92RFxSRUa8ckU4EAurWftDRASBKuq';

/**
 * Refuses to boot on a mismatched environment bundle — e.g. the production Supabase project
 * paired with a non-production Solana fee payer, or vice versa. This is the actual safety net
 * behind the .env.development.local / .env.production.local split (see ENVIRONMENTS.md): which
 * file gets loaded is a matter of discipline (LOOFTA_ENV_FILE, which npm script ran) and
 * discipline can fail under time pressure — this check can't silently drift, since it inspects
 * the values actually loaded into process.env regardless of which file they came from.
 */
export function assertEnvironmentCoherence(config: ConfigService): void {
  const supabaseUrl = config.get<string>('SUPABASE_URL') || '';
  const isProductionDb = supabaseUrl.includes(PRODUCTION_SUPABASE_REF);

  const feePayerKey = config.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY');
  let feePayerPubkey: string | null = null;
  if (feePayerKey) {
    try {
      feePayerPubkey = Keypair.fromSecretKey(bs58.decode(feePayerKey.trim())).publicKey.toBase58();
    } catch {
      // An invalid/undecodable key is a different, pre-existing failure each service that
      // actually needs it already logs on its own (e.g. SolanaSponsorService) — not this guard's
      // job to also report it.
    }
  }
  const isProductionFeePayer = feePayerPubkey === PRODUCTION_FEE_PAYER_PUBKEY;

  // Only compare when we actually have a fee payer key to check — an unset key is its own
  // (already logged elsewhere) problem, not an environment-mismatch one.
  if (feePayerPubkey && isProductionDb !== isProductionFeePayer) {
    throw new Error(
      `Refusing to start: SUPABASE_URL ${isProductionDb ? 'IS' : 'is NOT'} the production project, but ` +
        `SOLANA_FEE_PAYER_PRIVATE_KEY ${isProductionFeePayer ? 'IS' : 'is NOT'} the production fee payer. ` +
        `These must match — mixing them is exactly the "devnet key writes into the production DB" failure ` +
        `mode ENVIRONMENTS.md exists to prevent. Check which .env.*.local file actually loaded ` +
        `(LOOFTA_ENV_FILE env var / which npm script ran).`,
    );
  }
}
