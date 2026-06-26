import { type NextRequest, NextResponse } from "next/server";
import { getVerifiedUserId } from "@/lib/serverAuth";

const MAGICBLOCK_API = "https://payments.magicblock.app";

function isAllowedRpcHost(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url);
    return protocol === "https:" && (
      hostname.endsWith(".magicblock.app") ||
      hostname === "magicblock.app"
    );
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const userId = await getVerifiedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { transactionBase64, sendTo, sendRpcEndpoint } = await request.json() as {
      transactionBase64?: string;
      sendTo?: "base" | "ephemeral";
      sendRpcEndpoint?: string;
    };
    const authorization = request.headers.get("authorization")?.trim() ?? "";

    if (typeof transactionBase64 !== "string" || !transactionBase64.trim()) {
      return NextResponse.json({ error: "Missing transactionBase64" }, { status: 400 });
    }
    if (sendTo !== "base" && sendTo !== "ephemeral") {
      return NextResponse.json({ error: "sendTo must be 'base' or 'ephemeral'" }, { status: 400 });
    }

    // When an ephemeral RPC endpoint is provided, submit via standard JSON-RPC sendTransaction.
    // MagicBlock's undelegate response always includes sendRpcEndpoint for ephemeral txs.
    if (sendTo === "ephemeral" && sendRpcEndpoint) {
      if (!isAllowedRpcHost(sendRpcEndpoint)) {
        return NextResponse.json({ error: "RPC endpoint not allowed" }, { status: 400 });
      }
      const rpcRes = await fetch(sendRpcEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "sendTransaction",
          params: [transactionBase64, { encoding: "base64", skipPreflight: true }],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const rpcBody = await rpcRes.json().catch(() => null);
      if (rpcBody?.error) {
        return NextResponse.json(
          { error: rpcBody.error.message ?? "RPC sendTransaction failed", details: rpcBody },
          { status: 500 },
        );
      }
      return NextResponse.json({ signature: rpcBody?.result ?? null });
    }

    // Fall back to MagicBlock's HTTP transaction send API
    const res = await fetch(`${MAGICBLOCK_API}/v1/transaction/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify({ transactionBase64, sendTo, cluster: "mainnet-private" }),
      signal: AbortSignal.timeout(30_000),
    });

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return NextResponse.json(
        { error: body?.error?.message ?? body?.message ?? `Send failed: ${res.status}`, details: body },
        { status: res.status },
      );
    }
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send transaction" },
      { status: 500 },
    );
  }
}
