# Megapot private-lottery bridge (Relay / Li.Fi)

Reference for AI agents and devs working on the Megapot lottery in `apps/backend`.

## What bridges, and why

Megapot tickets live on **Base** (USDC), but users pay privately from **Solana** via a MagicBlock
private transfer. So every private ticket has a cross-chain bridge on each side:

| Leg | Direction | From → To | Code |
|---|---|---|---|
| **Purchase** | Solana → Base | burner (SOL) → companion (Base smart account) | `tryStartBridge` |
| **Withdrawal** | Base → Solana | companion (Base) → withdrawal burner (SOL) | `bridgeCompanionToBurner` |

Loofta absorbs the bridge cost (users are not charged a separate fee — see the fee-removal change).

## Bridge provider: Relay (default) with Li.Fi fallback

Both legs go through **[Relay](https://relay.link)** — chosen for speed (~1–3s vs. Li.Fi's
Mayan/Allbridge Solana routes). Selected by a single env flag:

```
BRIDGE_PROVIDER=relay   # or "lifi" to fall back
RELAY_API_KEY=...       # required when BRIDGE_PROVIDER=relay
```

- Flag read via `LotteryService.bridgeProvider`. It only governs which bridge a **new** leg
  *starts* with.
- **In-flight bridges keep whichever tool they started with.** Every status poll branches on the
  stored tool (`lottery_tickets.lifi_buy_tool` / `lottery_withdrawals.lifi_step_tool` — value
  `'relay'` or a Li.Fi tool name), NOT the flag. So flipping `BRIDGE_PROVIDER` never orphans a
  bridge mid-flight, and reverting to `lifi` is instant and safe (no migration).

Withdrawals also run on Li.Fi's `RelayService`-agnostic Rhinestone userOp path — the Relay deposit
is executed by the same sponsored `rhinestone.executeLifiSwap` (approve Relay's Base router, then
call it).

## Relay specifics (verified against the live API)

- **Solana chainId = `792703809`**, Base = `8453`.
- **Purchase (Sol→Base)**: quote `tradeType: EXACT_OUTPUT` for the ticket cost → the companion is
  guaranteed to net exactly the cost; Relay returns the required input (cost + ~$0.02 fee), which we
  cover by topping the burner up from the fee wallet. The deposit step returns raw Solana
  `instructions` (hex `data`, base58 keys) + `addressLookupTableAddresses`; we build a v0 tx, fund
  the burner's SOL gas, sign, send.
- **Withdrawal (Base→Sol)**: quote `EXACT_INPUT`; the EVM origin returns an `approve` + `deposit`
  step. `deposit.to` is Relay's Base router (also the approval spender). Run as a Rhinestone userOp.
- **Status**: polled by `requestId` at `GET /intents/status?requestId=…` → `success|failure|refund|…`.
  We store the `requestId` in the existing `lifi_buy_tx_hash` / `lifi_tx_hash` columns (repurposed)
  with tool `'relay'`.
- Fee is mostly-flat ~$0.02, so ~0.4–0.8% on a $5 leg, negligible on larger.

Implementation: `apps/backend/src/modules/lottery/relay.service.ts`.

## Testing / rollout

This is money-moving code. Before trusting Relay in production, run one small real **buy** and one
real **redeem** and confirm the ticket reaches `active` / USDC lands in the wallet. If anything is
off, set `BRIDGE_PROVIDER=lifi` (or remove it) to revert instantly. Set both env vars on Railway.
