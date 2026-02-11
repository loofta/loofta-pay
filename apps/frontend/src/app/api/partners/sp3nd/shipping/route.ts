"use server";

import { NextResponse } from "next/server";
import { updateCartShippingAddress } from "../client";

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { cart_id, shipping_address } = body || {};

    if (!cart_id || !shipping_address) {
      return NextResponse.json(
        { error: "cart_id and shipping_address are required" },
        { status: 400 }
      );
    }

    const {
      first_name,
      last_name,
      address_line_1,
      address_line_2,
      city,
      state,
      postal_code,
      country,
      phone,
    } = shipping_address;

    if (!first_name || !last_name || !address_line_1 || !city || !postal_code || !country || !phone) {
      return NextResponse.json(
        { error: "Missing required shipping fields: first_name, last_name, address_line_1, city, postal_code, country, phone" },
        { status: 400 }
      );
    }

    const result = await updateCartShippingAddress(cart_id, {
      first_name: String(first_name).trim(),
      last_name: String(last_name).trim(),
      address_line_1: String(address_line_1).trim(),
      ...(address_line_2 ? { address_line_2: String(address_line_2).trim() } : {}),
      city: String(city).trim(),
      ...(state ? { state: String(state).trim() } : {}),
      postal_code: String(postal_code).trim(),
      country: String(country).trim(),
      phone: String(phone).trim(),
    });
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[sp3nd/shipping]", e);
    return NextResponse.json(
      { error: e?.message || "Failed to update shipping" },
      { status: 500 }
    );
  }
}
