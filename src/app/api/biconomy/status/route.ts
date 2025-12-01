import { NextResponse } from "next/server";
import { getBiconomyStatus } from "@/services/biconomy";

export async function GET(req: Request) {
	try {
		const { searchParams } = new URL(req.url);
		const id = (searchParams.get("id") || "").trim();
		if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
		const s = await getBiconomyStatus(id);
		return NextResponse.json(s, { status: 200 });
	} catch (e: any) {
		return NextResponse.json({ error: e?.message || "Status failed" }, { status: 500 });
	}
}


