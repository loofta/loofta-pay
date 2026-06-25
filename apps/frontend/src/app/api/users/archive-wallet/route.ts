import { NextRequest, NextResponse } from "next/server";

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
  try {
    const { privyUserId, walletAddress } = await request.json() as {
      privyUserId?: string;
      walletAddress?: string;
    };

    if (!privyUserId || !walletAddress) {
      return NextResponse.json({ error: "privyUserId and walletAddress are required" }, { status: 400 });
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
