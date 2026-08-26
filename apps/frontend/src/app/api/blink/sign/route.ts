import { NextRequest, NextResponse } from "next/server";
import { randomUUID, createSign } from "node:crypto";
import { getVerifiedUserId } from "@/lib/serverAuth";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

const MERCHANT_ID = process.env.BLINK_MERCHANT_ID ?? "";
const SOLANA_CHAIN_ID = 792703809;
const USDC_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function getPrivateKey(): string {
  const raw = process.env.BLINK_MERCHANT_PRIVATE_KEY ?? "";
  // Handle env vars where newlines are stored as literal \n
  return raw.replace(/\\n/g, "\n");
}

function isValidSolanaAddress(address: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

export async function POST(req: NextRequest) {
  if (!MERCHANT_ID) {
    return NextResponse.json({ error: "Merchant not configured" }, { status: 500 });
  }

  const privateKeyPem = getPrivateKey();
  if (!privateKeyPem) {
    return NextResponse.json({ error: "Signer not configured" }, { status: 500 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  let { amount, chainId, address, token, callbackScheme = null, version = "v1", reference, metadata } = body as {
    amount: unknown;
    chainId: unknown;
    address: unknown;
    token: unknown;
    callbackScheme?: string | null;
    version?: string;
    reference?: string;
    metadata?: Record<string, string>;
    checkoutClaimId?: string;
  };

  // Guest checkout: this signer is merchant-scoped (BLINK_MERCHANT_ID/PRIVATE_KEY, Loofta's own
  // credentials, not tied to any Loofta user), and never verified that `address` belonged to the
  // authenticated caller anyway — so the login requirement below was only ever a "must have an
  // account to use this" gate, not an ownership check. checkoutClaimId skips that gate but, same
  // as Coinbase's guest mode, ignores whatever `address` the client sent and resolves the real
  // destination server-side from the claim's own burner — never trusting a client-supplied
  // destination just because a claim id was attached to the request.
  const checkoutClaimId = (body as { checkoutClaimId?: string }).checkoutClaimId;
  if (checkoutClaimId) {
    const supabase = getSupabaseAdmin();
    const { data: claim } = await supabase
      .from("payments")
      .select("direction, status, burner_address")
      .eq("id", checkoutClaimId)
      .maybeSingle();
    const payable = ["OPEN", "PENDING_DEPOSIT"].includes(String(claim?.status || "").toUpperCase());
    if (!claim || claim.direction !== "from_recipient" || !payable || !claim.burner_address) {
      return NextResponse.json({ error: "This payment link isn't available for guest checkout." }, { status: 400 });
    }
    address = claim.burner_address;
  } else {
    const userId = await getVerifiedUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Validate fields

  if (chainId !== SOLANA_CHAIN_ID) {
    return NextResponse.json({ error: "Unsupported chainId — only Solana (792703809) is accepted" }, { status: 400 });
  }
  if (typeof address !== "string" || !isValidSolanaAddress(address)) {
    return NextResponse.json({ error: "Invalid Solana address" }, { status: 400 });
  }
  if (token !== USDC_SOLANA) {
    return NextResponse.json({ error: "Unsupported token — only USDC on Solana is accepted" }, { status: 400 });
  }

  const idempotencyKey = randomUUID();
  const signatureTimestamp = new Date().toISOString();

  const payloadObject = {
    amount,
    chainId,
    address,
    token,
    idempotencyKey,
    callbackScheme: callbackScheme ?? null,
    signatureTimestamp,
    version: version ?? "v1",
    ...(reference ? { reference } : {}),
    ...(metadata ? { metadata } : {}),
  };

  const payload = Buffer.from(JSON.stringify(payloadObject), "utf8").toString("base64url");

  let signature: string;
  try {
    const signer = createSign("SHA256");
    signer.update(payload);
    signer.end();
    signature = signer.sign(privateKeyPem).toString("base64url");
  } catch (err) {
    console.error("[blink/sign] signing failed", err);
    return NextResponse.json({ error: "Signing failed" }, { status: 500 });
  }

  return NextResponse.json(
    {
      merchantId: MERCHANT_ID,
      payload,
      signature,
      preview: {
        amount,
        chainId,
        address,
        token,
        idempotencyKey,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
