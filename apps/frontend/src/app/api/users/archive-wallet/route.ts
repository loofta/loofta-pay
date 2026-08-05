import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import { getVerifiedUserId } from "@/lib/serverAuth";
import { getRpcForMode, getUsdcMintForMode } from "@/lib/solanaRpc";

// Anything above this is a real balance, not float dust — this flow is mainnet-only
// (part of the mandatory wallet upgrade, MAINNET_WALLET_UPDATE_ID), so mainnet RPC/mint.
const DUST_LAMPORTS = 5000;

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID!;
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET!;
const PRIVY_API = "https://api.privy.io/v1";

function privyAuth() {
  const creds = Buffer.from(`${PRIVY_APP_ID}:${PRIVY_APP_SECRET}`).toString("base64");
  return {
    Authorization: `Basic ${creds}`,
    "privy-app-id": PRIVY_APP_ID,
    "Content-Type": "application/json",
  };
}

export async function POST(request: NextRequest) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { walletAddress } = await request.json() as { walletAddress?: string };

    if (!walletAddress) {
      return NextResponse.json({ error: "walletAddress is required" }, { status: 400 });
    }

    // Fetch the user from Privy to find the internal wallet ID
    const userRes = await fetch(`${PRIVY_API}/users/${encodeURIComponent(privyUserId)}`, {
      headers: privyAuth(),
    });

    if (!userRes.ok) {
      const body = await userRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: body?.message ?? `Failed to fetch user from Privy (${userRes.status})` },
        { status: userRes.status }
      );
    }

    const userData = await userRes.json();
    const linkedAccounts: Array<Record<string, string>> = userData.linked_accounts ?? [];

    // Find the wallet matching the address — wallets use type "wallet" in Privy's API
    const wallet = linkedAccounts.find((a) => a.address === walletAddress);
    const walletId = wallet?.id;

    if (!walletId) {
      return NextResponse.json(
        { error: "Wallet not found on this account" },
        { status: 404 }
      );
    }

    // Hard invariant: a wallet holding real funds must never be archived — Privy blocks all
    // signing on an archived wallet, so this is how deposits/payments get permanently stranded
    // behind a wallet rotation (real incidents: users cmq9rrtii001h0ckzcw9ky9d4, cmq1ja1zf005q0cjucz5eg5d8,
    // 2026-08-05). Fail closed: if we can't confirm the wallet is empty, don't archive it.
    try {
      const conn = new Connection(getRpcForMode("mainnet"), "confirmed");
      const pubkey = new PublicKey(walletAddress);
      const [solBalance, usdcBalance] = await Promise.all([
        conn.getBalance(pubkey),
        getAssociatedTokenAddress(getUsdcMintForMode("mainnet"), pubkey)
          .then((ata) => getAccount(conn, ata))
          .then((acc) => acc.amount)
          .catch(() => BigInt(0)), // no USDC token account = no USDC balance
      ]);
      if (solBalance > DUST_LAMPORTS || usdcBalance > BigInt(0)) {
        return NextResponse.json(
          { error: "This wallet still holds funds and cannot be archived. Move funds out first, or contact support." },
          { status: 409 }
        );
      }
    } catch (e: any) {
      return NextResponse.json(
        { error: "Could not verify this wallet is empty before archiving — try again." },
        { status: 502 }
      );
    }

    // Archive it
    const archiveRes = await fetch(`${PRIVY_API}/wallets/${walletId}/archive`, {
      method: "POST",
      headers: privyAuth(),
      body: JSON.stringify({}),
    });

    if (!archiveRes.ok) {
      const body = await archiveRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: body?.message ?? `Privy archive failed (${archiveRes.status})` },
        { status: archiveRes.status }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Internal server error" },
      { status: 500 }
    );
  }
}
