import { NextRequest, NextResponse } from "next/server";
import { randomUUID, createSign } from "node:crypto";

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

  const { amount, chainId, address, token, callbackScheme = null, version = "v1", reference, metadata } = body as {
    amount: unknown;
    chainId: unknown;
    address: unknown;
    token: unknown;
    callbackScheme?: string | null;
    version?: string;
    reference?: string;
    metadata?: Record<string, string>;
  };

  // Validate fields
  if (!Number.isFinite(amount) || (amount as number) <= 0) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  }
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
