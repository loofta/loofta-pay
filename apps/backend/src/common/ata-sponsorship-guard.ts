import { Logger } from '@nestjs/common';
import type { SupabaseService } from '@/database/supabase.service';

const log = new Logger('AtaSponsorshipGuard');

/**
 * Anti-drain guard for sponsor-paid ATA creation. Whenever our fee payer pays the rent to
 * create a wallet's USDC ATA, that rent is only ours to lose once — the wallet's owner can
 * close the account later and reclaim the rent for themselves, then get sponsored again the
 * next time. Without this guard, that create→close→repeat cycle is a free, repeatable drain
 * on the fee payer (see project memory: Solana sponsor security hardening, July 2026).
 *
 * Shared version of ClaimsService's private `guardAtaSponsorship` — same table
 * (`ata_sponsorships`, unique on (wallet_address, mint)), same insert-then-catch-conflict
 * logic, exported so any module whose fee payer creates a destination ATA can call it too.
 *
 * Records a first-ever sponsorship via an insert that fails on conflict. Returns true the
 * first time (safe to sponsor), false every time after (already paid for once — refuse to
 * pay again). Fails OPEN (returns true) only on a genuine DB error, since a false negative
 * here blocks a legitimate transfer entirely; a missed guard insert is a much smaller risk.
 */
export async function guardAtaSponsorship(
  supabaseService: SupabaseService,
  walletAddress: string,
  mint: string,
  context: string,
): Promise<boolean> {
  const { error } = await supabaseService.ataSponsorships.insert({
    wallet_address: walletAddress,
    mint,
    context,
  });
  if (!error) return true;
  // Postgres unique-violation — this (wallet, mint) was already sponsored once before.
  if (error.code === '23505') {
    log.warn(
      `BLOCKED repeat sponsorship for wallet=${walletAddress.slice(0, 8)}… mint=${mint.slice(0, 8)}… context=${context} — ATA was already paid for once; refusing to pay rent again.`,
    );
    return false;
  }
  log.warn(`guard insert failed (failing open): ${error.message}`);
  return true;
}
