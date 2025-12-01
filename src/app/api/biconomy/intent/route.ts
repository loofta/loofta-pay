import { NextResponse } from "next/server";
import { createSupertransaction } from "@/services/biconomy";

export async function POST(req: Request) {
	try {
		const body = await req.json();
		const { fromToken, toToken, amountInHuman, recipient, userAddress, slippageBps, deadlineSeconds, routeHint } = body || {};
		if (!fromToken?.tokenId && !fromToken?.address) return NextResponse.json({ error: "Missing fromToken" }, { status: 400 });
		if (!toToken?.tokenId && !toToken?.address) return NextResponse.json({ error: "Missing toToken" }, { status: 400 });
		if (!amountInHuman) return NextResponse.json({ error: "Missing amountInHuman" }, { status: 400 });
		if (!userAddress) return NextResponse.json({ error: "Missing userAddress" }, { status: 400 });
		if (!recipient) return NextResponse.json({ error: "Missing recipient" }, { status: 400 });
		const intent = await createSupertransaction({ fromToken, toToken, amountOutHuman: amountInHuman, recipient, userAddress, slippageBps, deadlineSeconds, routeHint });
		return NextResponse.json(intent, { status: 200 });
	} catch (e: any) {
		console.error(e);
		return NextResponse.json({ error: e?.message || "Intent creation failed" }, { status: 500 });
	}
}


