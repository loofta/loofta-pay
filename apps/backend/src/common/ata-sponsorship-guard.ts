import { Logger } from '@nestjs/common';
import type { SupabaseService } from '@/database/supabase.service';
import type { EmailService } from '@/modules/email/email.service';

const log = new Logger('AtaSponsorshipGuard');

// Per-process de-dupe so a hammering attacker doesn't spam the inbox — one alert per wallet is
// enough to know it's happening; the guard itself still blocks every single attempt regardless.
// Resets on deploy/restart, which is an acceptable trade-off for an alert (not a money control).
const alertedWallets = new Set<string>();
const ATA_ABUSE_ALERT_EMAIL = 'lisa.bechina@gmail.com';

// Hard ceiling on the alert itself, independent of the per-wallet de-dupe above — that de-dupe
// does nothing against an attacker who cycles through many DIFFERENT wallets (trivial and free
// to generate), which would otherwise mean one email per new wallet with no upper bound. This
// email pool is shared with real user-facing sends (win notifications, payment claims) that ride
// the same Resend account and monthly quota — an alert storm must never be able to starve those.
// Past this cap within the window, blocks continue exactly as before (the guard's actual
// protection is untouched); only the notification is suppressed, logged instead.
const MAX_ABUSE_ALERTS_PER_WINDOW = 1;
const ALERT_WINDOW_MS = 60 * 60_000; // 1 hour
let alertWindowStartedAt = 0;
let alertsSentInWindow = 0;

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
 *
 * `emailService` is optional — pass it when the caller already has one injected (most do) so a
 * blocked attempt actually gets *seen*, not just logged. A real incident (2026-07-29) had this
 * guard correctly blocking abuse in one place while the same fee payer was actively being
 * drained through an unguarded sibling call site, and nobody noticed until a manual on-chain
 * review days later — a warn-level log line alone isn't enough for something this financially
 * sensitive. Best-effort: never let the alert itself affect the guard's return value. Both a
 * per-wallet de-dupe and a global hourly cap bound how many of these emails can ever go out, so
 * an attack can't burn through the shared Resend quota that real user-facing emails also use —
 * see MAX_ABUSE_ALERTS_PER_WINDOW below. The guard's actual protection (refusing to sponsor) is
 * completely unaffected by that cap; only the notification is throttled.
 */
export async function guardAtaSponsorship(
  supabaseService: SupabaseService,
  walletAddress: string,
  mint: string,
  context: string,
  emailService?: EmailService,
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
    if (emailService && !alertedWallets.has(walletAddress)) {
      const now = Date.now();
      if (now - alertWindowStartedAt > ALERT_WINDOW_MS) {
        alertWindowStartedAt = now;
        alertsSentInWindow = 0;
      }
      if (alertsSentInWindow >= MAX_ABUSE_ALERTS_PER_WINDOW) {
        log.warn(`abuse alert SUPPRESSED (hourly cap ${MAX_ABUSE_ALERTS_PER_WINDOW} reached) for wallet=${walletAddress.slice(0, 8)}… — guard is still blocking the sponsorship, only the email is throttled`);
      } else {
        alertedWallets.add(walletAddress);
        alertsSentInWindow++;
        emailService
          .sendAtaSponsorshipAbuseAlertEmail({ to: ATA_ABUSE_ALERT_EMAIL, walletAddress, mint, context })
          .catch((e) => log.warn(`abuse alert email failed (non-fatal): ${(e as Error)?.message}`));
      }
    }
    return false;
  }
  log.warn(`guard insert failed (failing open): ${error.message}`);
  return true;
}
