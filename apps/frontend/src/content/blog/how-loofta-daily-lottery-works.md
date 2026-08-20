---
title: "How Loofta's Daily USDC Lottery Works"
description: "Loofta runs a daily USDC lottery. Here's how ticket pricing, prize tiers, and draws work, and how to play it from a Solana wallet."
publishedAt: "2026-08-07"
---

Megapot, the licensed protocol Loofta integrates with, runs a daily USDC draw. Instead of buying a physical ticket or picking numbers at a kiosk, you buy an on-chain ticket through Loofta, and Megapot's daily draw decides who wins.

## Ticket price and draws

Each ticket costs **$1 in USDC**. Megapot runs draws **daily**, with entries cut off a few minutes before the round closes so the draw can settle cleanly.

## How prizes are structured

Megapot's prizes aren't a single jackpot-or-nothing outcome. They're split into tiers based on how many numbers you match, plus a bonus number. Matching everything pays out the top tier (a live, growing jackpot rather than a fixed number), and lower match counts still pay smaller, fixed amounts, down to a free ticket for the lowest tier. That tiered structure means most outcomes aren't a total loss, even if they're not the jackpot.

The live jackpot total and the current round's state are pulled directly from Megapot at the time you play, not hardcoded, so what you see reflects the actual pool.

## Where Megapot actually runs

Megapot's contracts are deployed on **Base**, not Solana. That matters if you're used to doing everything from a Solana wallet.

## Playing from Solana, through Loofta

Loofta lets you buy Megapot tickets while holding and paying from Solana. Here's what happens behind the scenes:

1. You send USDC on Solana to buy tickets.
2. Loofta bridges that value from Solana to Base, using [Relay](https://relay.link) by default (with a fallback provider if needed).
3. The actual ticket purchase executes on Base, through Megapot.
4. Loofta absorbs the bridging cost, so you're not paying a separate cross-chain fee on top of your ticket price.

The result is that you never have to hold Base ETH, set up a second wallet, or manually bridge anything, you just buy tickets the same way you'd send a payment.

## Is it worth playing?

That's a personal call, and it comes down to the same thing any lottery does: you're paying for the entertainment of a chance at a large payout, with the odds structurally favoring the house. If that trade-off appeals to you and it's legal where you are, [Megapot, through Loofta](https://loofta.xyz/megapot) is the fastest way to try it from a Solana wallet.

For more on what to expect from the odds and prize tiers, see [Lottery Prize Tiers and Odds: What You Can Actually Win](/blog/lottery-prize-tiers-and-odds).
