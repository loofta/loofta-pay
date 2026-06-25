import { NextRequest, NextResponse } from "next/server";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID!;
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET!;

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
    const { privyUserId } = await request.json() as { privyUserId?: string };

    if (!privyUserId) {
      return NextResponse.json({ error: "privyUserId is required" }, { status: 400 });
    }

    const res = await fetch(
      `https://api.privy.io/v1/users/${encodeURIComponent(privyUserId)}/wallets`,
      {
        method: "POST",
        headers: privyAuth(),
        body: JSON.stringify({ create_solana_wallet: true }),
      }
    );

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: body?.message ?? body?.error ?? `Privy wallet creation failed (${res.status})` },
        { status: res.status }
      );
    }

    const user = await res.json();
    const solanaWallets = (user.linked_accounts ?? []).filter(
      (a: Record<string, string>) => a.chain_type === "solana" && !a.archived_at
    );
    const newest = solanaWallets[solanaWallets.length - 1];

    return NextResponse.json({ address: newest?.address ?? null });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal server error" }, { status: 500 });
  }
}
