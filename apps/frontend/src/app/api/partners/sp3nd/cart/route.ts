"use server";

import { NextResponse } from "next/server";
import { createCart, getCart, addItemToCart } from "../client";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { product_url, quantity = 1, cart_id, items: bodyItems } = body || {};

    const url =
      typeof product_url === "string" ? product_url.trim() : "";
    const qty = Number(quantity) || 1;

    if (cart_id && url) {
      if (!url.includes("amazon") && !url.includes("amzn.")) {
        return NextResponse.json(
          { error: "Please enter a valid Amazon product URL" },
          { status: 400 }
        );
      }
      const result = await addItemToCart(cart_id, {
        product_url: url,
        quantity: qty,
      });
      return NextResponse.json(result);
    }

    if (cart_id) {
      const cart = await getCart(cart_id);
      return NextResponse.json(cart);
    }

    const itemsArray = Array.isArray(bodyItems) && bodyItems.length > 0
      ? bodyItems
      : url ? [{ product_url: url, quantity: qty }] : null;

    if (!itemsArray || itemsArray.length === 0) {
      return NextResponse.json(
        { error: "product_url or items array is required" },
        { status: 400 }
      );
    }

    const normalized = itemsArray.map((i: any) => ({
      product_url: typeof i?.product_url === "string" ? i.product_url.trim() : "",
      quantity: Number(i?.quantity) || 1,
    })).filter((i) => i.product_url.length > 0);

    if (normalized.length === 0) {
      return NextResponse.json(
        { error: "At least one valid product_url is required" },
        { status: 400 }
      );
    }

    for (const i of normalized) {
      if (!i.product_url.includes("amazon") && !i.product_url.includes("amzn.")) {
        return NextResponse.json(
          { error: "Please enter valid Amazon product URLs" },
          { status: 400 }
        );
      }
    }

    const result = await createCart(normalized);
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[sp3nd/cart]", e);
    return NextResponse.json(
      { error: e?.message || "Failed to create cart" },
      { status: 500 }
    );
  }
}
