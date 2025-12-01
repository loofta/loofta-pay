import { NextResponse } from "next/server";
import { getQuoteExactOutput } from "@/services/biconomy";

export async function POST(req: Request) {
	try {
		const body = await req.json();
		const { fromToken, toToken, amountInHuman, recipient, userAddress, slippageBps, deadlineSeconds } = body || {};
		if (!fromToken?.tokenId && !fromToken?.address) return NextResponse.json({ error: "Missing fromToken" }, { status: 400 });
		if (!toToken?.tokenId && !toToken?.address) return NextResponse.json({ error: "Missing toToken" }, { status: 400 });
		if (!amountInHuman) return NextResponse.json({ error: "Missing amountInHuman" }, { status: 400 });
		if (!userAddress) return NextResponse.json({ error: "Missing userAddress" }, { status: 400 });
		const q = await getQuoteExactOutput({ fromToken, toToken, amountOutHuman: amountInHuman, recipient, userAddress, slippageBps, deadlineSeconds });
		return NextResponse.json(q, { status: 200 });
	} catch (e: any) {
		return NextResponse.json({ error: e?.message || "Quote failed" }, { status: 500 });
	}
}


