"use server";

import { NextResponse } from "next/server";
import { createCart, getCart } from "../client";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { product_url, quantity = 1, cart_id } = body || {};

    if (cart_id) {
      const cart = await getCart(cart_id);
      return NextResponse.json(cart);
    }

    if (!product_url || typeof product_url !== "string") {
      return NextResponse.json(
        { error: "product_url is required" },
        { status: 400 }
      );
    }

    const url = product_url.trim();
    if (!url.includes("amazon") && !url.includes("amzn.")) {
      return NextResponse.json(
        { error: "Please enter a valid Amazon product URL" },
        { status: 400 }
      );
    }

    const result = await createCart([{ product_url: url, quantity: Number(quantity) || 1 }]);
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[sp3nd/cart]", e);
    return NextResponse.json(
      { error: e?.message || "Failed to create cart" },
      { status: 500 }
    );
  }
}
