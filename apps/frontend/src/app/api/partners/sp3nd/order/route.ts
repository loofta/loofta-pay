"use server";

import { NextResponse } from "next/server";
import { createOrder } from "../client";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cart_id, shipping_address, customer_email, test } = body || {};

    if (!cart_id || !shipping_address || !customer_email) {
      return NextResponse.json(
        { error: "cart_id, shipping_address, and customer_email are required" },
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
        { error: "Missing required shipping fields (including phone)" },
        { status: 400 }
      );
    }

    const result = await createOrder({
      cart_id,
      shipping_address: {
        first_name: String(first_name).trim(),
        last_name: String(last_name).trim(),
        address_line_1: String(address_line_1).trim(),
        ...(address_line_2 ? { address_line_2: String(address_line_2).trim() } : {}),
        city: String(city).trim(),
        ...(state ? { state: String(state).trim() } : {}),
        postal_code: String(postal_code).trim(),
        country: String(country).trim(),
        phone: String(phone).trim(),
      },
      customer_email: String(customer_email).trim(),
      test: Boolean(test),
    });

    const order = result?.order || result;
    const order_id = order?.order_id;
    const order_number = order?.order_number;
    const total_amount = order?.total_amount ?? order?.total;

    if (!order_number || total_amount == null) {
      return NextResponse.json(
        { error: "Invalid order response from SP3ND" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      order_id,
      order_number,
      total_amount: Number(total_amount),
      memo: `SP3ND Order: ${order_number}`,
    });
  } catch (e: any) {
    console.error("[sp3nd/order]", e);
    return NextResponse.json(
      { error: e?.message || "Failed to create order" },
      { status: 500 }
    );
  }
}
