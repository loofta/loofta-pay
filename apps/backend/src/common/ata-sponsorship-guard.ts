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

// --- Fleet-wide burst circuit breaker ---------------------------------------------------------
// The per-wallet guard above only catches the SAME wallet being sponsored twice — trivially
// evaded by an attacker who spends a fresh throwaway wallet every time (each one is a legitimate
// "first sponsorship" as far as that guard is concerned). This tracks the RATE of first-time
// sponsorships across all wallets/call sites and trips a fleet-wide pause once it spikes,
// regardless of which wallets are involved.
//
// IMPORTANT — this is NOT what would have caught the 2026-08-03 x402 incident: that route drained
// at roughly 1 sponsorship per 20-30s (per its own disable-comment), which is the same order of
// magnitude as this app's ordinary legitimate cadence (checked against real fee-payer history —
// normal traffic runs ~1 per 20-90s per window, with organic bursts). A short window/low threshold
// can't separate an attacker at human-plausible pace from real users; that incident was actually
// closed by removing the unauthenticated route, not by rate-limiting it. This breaker exists only
// to catch a qualitatively different failure: a bot hammering far faster than any human-paced flow,
// SUSTAINED over several minutes — hence the longer window and higher bar below. Don't tune this
// down to "catch everything" — that just trades false positives (pausing real users) for a false
// sense of coverage against slow-drip abuse, which auth/guards at the call site are what actually
// stop. In-memory/per-process, same trade-off as the alert de-dupe above: resets on deploy/restart,
// acceptable because this is a defense-in-depth trip wire, not the only control.
const BURST_WINDOW_MS = Number(process.env.ATA_BURST_WINDOW_MS) || 10 * 60_000; // 10 minutes
const BURST_THRESHOLD = Number(process.env.ATA_BURST_THRESHOLD) || 40; // >40 sponsorships/10min ≈ sustained 1-per-15s, well above observed organic cadence
let recentSponsorshipTimestamps: number[] = [];
let breakerTrippedAt: number | null = null;

/** True while the fleet-wide burst breaker is tripped — every sponsorship attempt is refused
 *  until clearAtaSponsorshipBreaker() is called (e.g. from an admin endpoint), regardless of
 *  wallet/mint/context. */
export function isAtaSponsorshipBreakerTripped(): boolean {
  return breakerTrippedAt !== null;
}

export function getAtaSponsorshipBreakerStatus(): { tripped: boolean; trippedAt: string | null; recentCount: number } {
  const now = Date.now();
  recentSponsorshipTimestamps = recentSponsorshipTimestamps.filter((t) => now - t <= BURST_WINDOW_MS);
  return {
    tripped: breakerTrippedAt !== null,
    trippedAt: breakerTrippedAt ? new Date(breakerTrippedAt).toISOString() : null,
    recentCount: recentSponsorshipTimestamps.length,
  };
}

/** Manual reset — call only after confirming on-chain that the burst was legitimate traffic, or
 *  that the actual abuse vector has been fixed/deployed. Does NOT clear the underlying cause. */
export function clearAtaSponsorshipBreaker(): void {
  log.warn('Fleet-wide ATA-sponsorship circuit breaker manually cleared — resuming sponsored ATA creation.');
  breakerTrippedAt = null;
  recentSponsorshipTimestamps = [];
}

/** Records a first-time sponsorship and trips the breaker if the rate over the trailing window
 *  exceeds the threshold. Returns true the instant this call trips it (so the caller can alert
 *  exactly once, on the transition, not on every subsequent blocked attempt). */
function recordSponsorshipAndMaybeTrip(): boolean {
  const now = Date.now();
  recentSponsorshipTimestamps.push(now);
  recentSponsorshipTimestamps = recentSponsorshipTimestamps.filter((t) => now - t <= BURST_WINDOW_MS);
  if (recentSponsorshipTimestamps.length > BURST_THRESHOLD && breakerTrippedAt === null) {
    breakerTrippedAt = now;
    return true;
  }
  return false;
}

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
 * authenticated user is allowed, UP TO `MAX_SAME_CALLER_REPEATS` times — incident 2026-07-30:
 * this guard (added in "fix solana drain") started blocking real signed-in users on an ordinary
 * second payment to a destination whose ATA had been closed since (e.g. the destination wallet's
 * own app auto-closes empty accounts). The abuse this guard exists to stop — see July 2026
 * incident, ~60 sponsored creations of one wallet every ~10s — is anonymous/disposable-identity
 * repeat funding; a signed-in, rate-limited (RateLimitGuard), identifiable account asking again
 * for a destination it already paid for is a materially different risk. A DIFFERENT user
 * requesting the same wallet is still blocked exactly as before — this only relaxes the
 * same-caller case.
 *
 * That relaxation was originally unconditional (re-allow forever) until incident 2026-08-06: the
 * same authenticated caller used it to run an unbounded create → close (reclaim rent) → repeat
 * cycle against a small, reused set of destination wallets, spread across days. A handful of
 * legitimate same-caller repeats is normal; unlimited is the drain. `repeat_count`
 * (migration `20260806170000`) tracks how many same-caller repeats a (wallet, mint) has already
 * been granted; past the cap it is blocked exactly like a different-caller repeat.
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

/** Lifetime cap on same-caller repeat sponsorships for a single (wallet, mint) — see
 *  guardAtaSponsorship doc comment, incident 2026-08-06. */
const MAX_SAME_CALLER_REPEATS = 2;

/** Rolling window + per-caller ceiling on *new* (rent-costing) ATA creations, shared across every
 *  call site whose destination is a fresh address every time (bridge deposit addresses, arbitrary
 *  client-signed destinations, etc.) — guardAtaSponsorship's same-wallet check does nothing there
 *  since the wallet is never repeated. See incident 2026-08-04 (solana-sponsor.service.ts's
 *  sign-and-broadcast): one caller sponsored 25+ distinct new wallets over ~2 hours, paced under
 *  any rate/burst threshold, at zero cost recovery. Call this BEFORE guardAtaSponsorship whenever
 *  a call site (a) has an authenticated userId available and (b) has no same-transaction cost
 *  recovery (no compensating burner-close, no upfront pricing) — i.e. exactly the cases flagged
 *  "GAP" in the 2026-08-04 fee-payer audit. Skip it entirely for call sites that already recover
 *  cost (claims sweep, lottery/private-balance withdrawals that close their burner, multi-send's
 *  upfront pricing) — this is a blunt backstop for the unpriced paths, not a universal tax. */
const ATA_PER_USER_WINDOW_HOURS = Number(process.env.ATA_PER_USER_WINDOW_HOURS) || 24;
const ATA_PER_USER_CAP = Number(process.env.ATA_PER_USER_CAP) || 10;

export async function assertPerUserAtaCreationCapNotExceeded(
  supabaseService: SupabaseService,
  userId: string,
  newAtaCount: number,
  label: string,
): Promise<void> {
  if (newAtaCount <= 0) return;
  const windowStart = new Date(Date.now() - ATA_PER_USER_WINDOW_HOURS * 60 * 60_000).toISOString();
  const { count, error } = await supabaseService.ataSponsorships
    .select('wallet_address', { count: 'exact', head: true })
    .ilike('context', `%${CALLER_MARKER}${userId}`)
    .gte('first_sponsored_at', windowStart);
  if (error) {
    log.warn(`[${label}] per-user ATA cap check failed (failing open): ${error.message}`);
    return;
  }
  if ((count ?? 0) + newAtaCount > ATA_PER_USER_CAP) {
    log.error(
      `[${label}] BLOCKED user=${userId} — would exceed ${ATA_PER_USER_CAP} sponsored new ATAs per ${ATA_PER_USER_WINDOW_HOURS}h (already at ${count}, this request adds ${newAtaCount})`,
    );
    throw new Error(
      `You've reached the limit of ${ATA_PER_USER_CAP} new-recipient sends per ${ATA_PER_USER_WINDOW_HOURS}h that don't already have a token account. Please try again later or use multi-send for bulk payouts.`,
    );
  }
}

export async function guardAtaSponsorship(
  supabaseService: SupabaseService,
  walletAddress: string,
  mint: string,
  context: string,
  emailService?: EmailService,
  callerUserId?: string,
): Promise<boolean> {
  if (breakerTrippedAt !== null) {
    log.error(
      `BLOCKED — fleet-wide circuit breaker tripped at ${new Date(breakerTrippedAt).toISOString()}, refusing ALL sponsored ATA creation (wallet=${walletAddress.slice(0, 8)}…, context=${context}) until manually cleared.`,
    );
    return false;
  }

  const storedContext = callerUserId ? `${context}${CALLER_MARKER}${callerUserId}` : context;
  const { error } = await supabaseService.ataSponsorships.insert({
    wallet_address: walletAddress,
    mint,
    context: storedContext,
  });
  if (!error) {
    if (recordSponsorshipAndMaybeTrip()) {
      log.error(
        `CIRCUIT BREAKER TRIPPED: more than ${BURST_THRESHOLD} new sponsored ATAs created within ${BURST_WINDOW_MS / 1000}s (last: wallet=${walletAddress.slice(0, 8)}…, context=${context}) — pausing ALL sponsored ATA creation fleet-wide until manually cleared.`,
      );
      if (emailService) {
        emailService
          .sendAtaSponsorshipBurstAlertEmail({
            to: ATA_ABUSE_ALERT_EMAIL,
            count: recentSponsorshipTimestamps.length,
            windowSeconds: BURST_WINDOW_MS / 1000,
            context,
          })
          .catch((e) => log.warn(`burst alert email failed (non-fatal): ${(e as Error)?.message}`));
      }
    }
    return true;
  }
  // Postgres unique-violation — this (wallet, mint) was already sponsored once before.
  if (error.code === '23505') {
    if (callerUserId) {
      const { data: existingRow } = await supabaseService.ataSponsorships
        .select('context, repeat_count')
        .eq('wallet_address', walletAddress)
        .eq('mint', mint)
        .maybeSingle();
      const priorCallerId = (existingRow?.context as string | undefined)?.split(CALLER_MARKER)[1];
      const repeatCount = (existingRow?.repeat_count as number | undefined) ?? 0;
      if (priorCallerId && priorCallerId === callerUserId) {
        if (repeatCount >= MAX_SAME_CALLER_REPEATS) {
          // Falls through to the generic BLOCKED log + alert below, with the same-caller context
          // already established — no separate log line needed here.
        } else {
          await supabaseService.ataSponsorships
            .update({ repeat_count: repeatCount + 1 })
            .eq('wallet_address', walletAddress)
            .eq('mint', mint);
          log.log(
            `ALLOWED repeat sponsorship for wallet=${walletAddress.slice(0, 8)}… mint=${mint.slice(0, 8)}… — same authenticated caller (${callerUserId}), repeat ${repeatCount + 1}/${MAX_SAME_CALLER_REPEATS}.`,
          );
          return true;
        }
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
