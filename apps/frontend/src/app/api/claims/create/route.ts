'use server'

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { isNonMainnetCluster } from "@/lib/solanaCluster";
import { generateShortId } from "@/lib/shortId";
import { getVerifiedUserId, isWalletAddressRegisteredOnLoofta, hasVerifiedIdentity } from "@/lib/serverAuth";
import { isValidAddressForChain } from "@/lib/refundAddresses";

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:3001";

const INTERNAL_SECRET = process.env.LOOFTA_INTERNAL_SECRET;

/** Minimum for a payment request made from the Loofta web app. Enforced here, server side, at
 * creation only, so it never touches payments that already exist. The SDK/merchant API, the
 * Telegram bot and the Twitter bot create payments through the backend and keep their own minimums. */
const APP_MIN_REQUEST_USD = 5;

/** Every payment routes through a burner and requires an explicit claim — mint one via the
 * backend, which alone has SEND_PAYMENT_ENC_KEY/KMS access to encrypt the burner secret. */
async function mintBurner(authHeader: string): Promise<{ burner_address: string; burner_encrypted_secret: string } | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/claims/internal/create-burner`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
        ...(INTERNAL_SECRET ? { "X-Loofta-Internal": INTERNAL_SECRET } : {}),
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const uid = await getVerifiedUserId(request);
  if (!uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await hasVerifiedIdentity(uid))) {
    return NextResponse.json({ error: "Add an email or a social account to your profile to use this feature." }, { status: 403 });
  }
  try {
    const { amount, toSel, recipient, description, direction, cluster, feeOnSender, isPrivate } = await request.json();
    if (!amount || !recipient) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    // Same bounds as the backend DTOs (@Min(0.01)). This route writes straight to the DB, so without
    // this a client could create 0, negative or absurd amounts (2026-11-20: -5 and 1e12 USDC rows).
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum < APP_MIN_REQUEST_USD || amountNum > 1_000_000) {
      return NextResponse.json({ error: `Amount must be between $${APP_MIN_REQUEST_USD} and $1,000,000.` }, { status: 400 });
    }

    // Destination: USDC on Solana by default, or any token on any chain the payer can be routed
    // to (NEAR Intents pays it straight to the external wallet). A Solana destination keeps the
    // burner + private-claim path and is USDC only; every other chain is a public transfer and
    // the address must be valid for that chain.
    const reqChain = String(toSel?.chain || "solana").trim().toLowerCase();
    const reqSymbol = String(toSel?.symbol || "USDC").trim().toUpperCase();
    if (!/^[a-z0-9_-]{2,32}$/.test(reqChain) || !/^[A-Z0-9._$-]{1,24}$/.test(reqSymbol)) {
      return NextResponse.json({ error: "Invalid destination token." }, { status: 400 });
    }
    const isSolanaDest = reqChain === "solana" || reqChain === "sol";
    if (isSolanaDest && reqSymbol !== "USDC") {
      return NextResponse.json({ error: "On Solana you can request USDC. Pick another network for other tokens." }, { status: 400 });
    }
    const destChain = isSolanaDest ? "solana" : reqChain;
    const destToken = isSolanaDest ? "USDC" : reqSymbol;
    if (!isValidAddressForChain(String(recipient).trim(), destChain)) {
      return NextResponse.json({ error: `Recipient must be a valid ${isSolanaDest ? "Solana" : destChain} wallet address.` }, { status: 400 });
    }

    // Privacy can only be disabled for a genuinely external wallet — never for a wallet
    // already registered on Loofta, even if the request claims it's "external".
    if (isSolanaDest && isPrivate === false && (await isWalletAddressRegisteredOnLoofta(String(recipient).trim()))) {
      return NextResponse.json(
        { error: "This wallet is registered on Loofta. Private payments are required for Loofta wallets — only external wallets can opt out of privacy." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const isFromRecipient = direction === 'from_recipient';
    const isDevnet = cluster === 'mainnet' ? false : cluster === 'devnet' ? true : isNonMainnetCluster();
    const shortId = generateShortId();

    // Every payment routes through a burner and requires an explicit claim — no exceptions.
    // A failed mint must not silently degrade into a burner-less (direct sender→recipient) claim.
    const burner = await mintBurner(request.headers.get("Authorization") ?? "");
    if (!burner) {
      console.error("[claims/create] burner minting failed — refusing to create a burner-less claim");
      return NextResponse.json(
        { error: "Could not prepare this payment right now. Please try again in a moment." },
        { status: 503 },
      );
    }

    const { data, error } = await supabase
      .from("payments")
      .insert({
        amount: Number(amount),
        direction: isFromRecipient ? 'from_recipient' : 'from_sender',
        recipient_address: String(recipient).trim(),
        created_by: uid,
        sender_user_id: isFromRecipient ? null : uid,
        recipient_user_id: isFromRecipient ? uid : null,
        status: "OPEN",
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        to_chain: destChain,
        to_token: destToken,
        is_devnet: isDevnet,
        description: description ? String(description).slice(0, 1000) : null,
        short_id: shortId,
        // Non-private links always bill the sender: the recipient declined private payments,
        // so any privacy fee incurred if the sender opts into one anyway is the sender's cost,
        // never deducted from the recipient's amount.
        fee_on_sender: isPrivate === false || !isSolanaDest ? true : feeOnSender !== false,
        // Private payments run through MagicBlock on Solana only; other chains are public transfers.
        is_private: isSolanaDest && isPrivate !== false,
        burner_address: burner.burner_address,
        burner_encrypted_secret: burner.burner_encrypted_secret,
      })
      .select("id")
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const id = data?.id;
    const origin = process.env.NEXT_PUBLIC_BASE_URL || "https://pay.loofta.com";
    const link = `${origin}/c/${shortId}`;
    return NextResponse.json({ id, short_id: shortId, link }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to create payment" }, { status: 500 });
  }
}
