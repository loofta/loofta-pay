# Mobile app

`apps/mobile` — Expo/React Native. Four tabs only (`app/(tabs)/_layout.tsx`): **Buy**
(`index.tsx`, 933 lines), **Redeem** (`redeem.tsx`, 811 lines), **History**, **Profile**. Plus
one modal-style route: `claim-gift.tsx`.

## Lottery

Fully built. `index.tsx` is a lottery-ticket purchase flow ported line-for-line from the web
app's `app/app/megapot/page.tsx` (comment: "Ported from... same field names"), including
cosmetic ticket-number picking (not sent to backend). Talks to `apps/mobile/lib/api/lottery.ts`
(`buyTickets`, `confirmBuy`, `getDashboard`, `getTicketStatus`, `withdrawBatch`, `playAgain`,
`getBridgeFee`) with fee/price constants in `apps/mobile/lib/lottery/fees.ts`. `redeem.tsx`
handles claiming winnings/withdrawals with a 3-step progress tracker (Redeemed → Traveling
privately → In your wallet). See [Lottery](LOTTERY.md) for the full backend flow this drives.

**Gift claiming also exists on mobile**: `claim-gift.tsx` + `lib/api/lotteryGift.ts`
(`claimLotteryGift`, `getLotteryGiftPublic`, `parseGiftToken`) — claiming a gifted set of
lottery tickets via a link/token. This is distinct from Mystery Packs (below).

## Mystery pack

**Not implemented in the mobile app.** Grepping all of `apps/mobile` for "mystery" or "pack"
returns zero hits. Mystery Packs (`apps/backend/src/modules/lottery/pack.service.ts`, admin
`PacksTab.tsx`, see [Lottery → Mystery Packs](LOTTERY.md#mystery-packs--odds--admin)) are
web-only today.

## Seeker login only

Confirmed: `apps/mobile/lib/auth/useSeekerLogin.ts` states explicitly that "'Log in' on mobile
means connecting the Seeker's own wallet — no email/OTP, no Privy embedded wallet." It uses
Privy's SIWS (`useLoginWithSiws`) purely for session issuance, with the actual signing done by
`apps/mobile/lib/wallet/mwa.ts` (Mobile Wallet Adapter → Seed Vault:
`connectAndSignMessage`/`signAndSendTransactionWithSeeker`,
`wallet.reauthorize`/`authorize`/`deauthorize`). `apps/mobile/lib/storage/seekerIdentity.ts`
caches the wallet's own `.skr` domain label.

`apps/mobile/components/AuthGate.tsx` is the single shared login-gate component ("Login UI
lives in one place — the Profile tab"), and `profile.tsx` only wires up
`useSeekerLogin`/`logoutSeeker` — no email/OTP UI exists anywhere in the mobile app.

**Gotcha**: `useSeekerLogin.ts` still has temporary debug `console.log`s of the raw SIWS
message/signature, left in from an "invalid siws message and/or nonce" investigation and
flagged in-code as "remove once login is confirmed working" — worth checking whether that's
still needed before shipping.
