/**
 * SP3ND Partner API client (server-side only).
 * Uses SP3ND_API_KEY and SP3ND_API_SECRET from env.
 */

const SP3ND_BASE =
  process.env.SP3ND_API_BASE ||
  "https://us-central1-sp3nddotshop-prod.cloudfunctions.net";

function getHeaders(): Record<string, string> {
  const key = process.env.SP3ND_API_KEY;
  const secret = process.env.SP3ND_API_SECRET;
  if (!key || !secret) {
    throw new Error("SP3ND_API_KEY and SP3ND_API_SECRET must be set");
  }
  return {
    "Content-Type": "application/json",
    "X-API-Key": key,
    "X-API-Secret": secret,
  };
}

export async function createCart(items: { product_url: string; quantity: number }[]) {
  const res = await fetch(`${SP3ND_BASE}/createPartnerCart`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ items }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `SP3ND createCart ${res.status}`);
  }
  return data;
}

export async function getCart(cartId: string) {
  const res = await fetch(`${SP3ND_BASE}/getPartnerCart/${cartId}`, {
    method: "GET",
    headers: getHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `SP3ND getCart ${res.status}`);
  }
  return data;
}

/** Add an item to an existing partner cart. Requires SP3ND to expose addToPartnerCart (or equivalent). */
export async function addItemToCart(
  cartId: string,
  item: { product_url: string; quantity: number }
) {
  const res = await fetch(`${SP3ND_BASE}/addToPartnerCart`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ cart_id: cartId, items: [item] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `SP3ND addToCart ${res.status}`);
  }
  return data;
}

export async function updateCartShippingAddress(
  cartId: string,
  shipping_address: {
    first_name: string;
    last_name: string;
    address_line_1: string;
    address_line_2?: string;
    city: string;
    state?: string;
    postal_code: string;
    country: string;
    phone: string;
  }
) {
  const res = await fetch(`${SP3ND_BASE}/updateCartShippingAddress/${cartId}`, {
    method: "PATCH",
    headers: getHeaders(),
    body: JSON.stringify({ shipping_address }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `SP3ND updateShipping ${res.status}`);
  }
  return data;
}

export async function createOrder(params: {
  cart_id: string;
  shipping_address: {
    first_name: string;
    last_name: string;
    address_line_1: string;
    address_line_2?: string;
    city: string;
    state?: string;
    postal_code: string;
    country: string;
    phone: string;
  };
  customer_email: string;
  test?: boolean;
}) {
  const res = await fetch(`${SP3ND_BASE}/createPartnerOrder`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      cart_id: params.cart_id,
      shipping_address: params.shipping_address,
      customer_email: params.customer_email,
      test: params.test ?? false,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `SP3ND createOrder ${res.status}`);
  }
  return data;
}
