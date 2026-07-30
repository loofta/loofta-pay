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
 * pay again) — UNLESS `callerUserId` matches the authenticated caller who funded it the first
 * time (see below). Fails OPEN (returns true) only on a genuine DB error, since a false
 * negative here blocks a legitimate transfer entirely; a missed guard insert is a much smaller
 * risk.
 *
 * `callerUserId`: pass the authenticated Privy user id when the call site is behind AuthGuard
 * (e.g. SolanaSponsorService's sign-and-broadcast path) — omit it for cron/backend-only call
 * sites with no live human caller (lottery rescue/topup, private-balance withdrawal), which keep
 * the original strict one-time-forever behavior since there's no identity to check against.
 * When present, a repeat sponsorship request for a (wallet, mint) already funded by that SAME
 * authenticated user is allowed rather than blocked — incident 2026-07-30: this guard (added in
 * "fix solana drain") started blocking real signed-in users on an ordinary second payment to a
 * destination whose ATA had been closed since (e.g. the destination wallet's own app auto-closes
 * empty accounts). The abuse this guard exists to stop — see July 2026 incident, ~60 sponsored
 * creations of one wallet every ~10s — is anonymous/disposable-identity repeat funding; a
 * signed-in, rate-limited (RateLimitGuard), identifiable account asking again for a destination
 * IT ALREADY paid for is a materially different risk (and if it is abuse, the account is now
 * known and can be banned, unlike a throwaway). A DIFFERENT user requesting the same wallet is
 * still blocked exactly as before — this only relaxes the same-caller case.
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
/** Deterministic marker appended to the stored context when a caller identity is known — kept
 *  separate from each call site's free-text context label so parsing it back out on a conflict
 *  doesn't depend on every call site formatting its label consistently (most don't). */
const CALLER_MARKER = '|caller:';

export async function guardAtaSponsorship(
  supabaseService: SupabaseService,
  walletAddress: string,
  mint: string,
  context: string,
  emailService?: EmailService,
  callerUserId?: string,
): Promise<boolean> {
  const storedContext = callerUserId ? `${context}${CALLER_MARKER}${callerUserId}` : context;
  const { error } = await supabaseService.ataSponsorships.insert({
    wallet_address: walletAddress,
    mint,
    context: storedContext,
  });
  if (!error) return true;
  // Postgres unique-violation — this (wallet, mint) was already sponsored once before.
  if (error.code === '23505') {
    if (callerUserId) {
      const { data: existingRow } = await supabaseService.ataSponsorships
        .select('context')
        .eq('wallet_address', walletAddress)
        .eq('mint', mint)
        .maybeSingle();
      const priorCallerId = (existingRow?.context as string | undefined)?.split(CALLER_MARKER)[1];
      if (priorCallerId && priorCallerId === callerUserId) {
        log.log(
          `ALLOWED repeat sponsorship for wallet=${walletAddress.slice(0, 8)}… mint=${mint.slice(0, 8)}… — same authenticated caller (${callerUserId}) as the original sponsorship, not an anonymous/fresh-identity repeat.`,
        );
        return true;
      }
    }
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
