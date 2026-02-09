"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowLeft, ShoppingBag } from "lucide-react";
import { organizationsApi } from "@/services/api/organizations";

type Step = "url" | "cart" | "payment" | "redirect";

const SP3ND_CHECKOUT_ORG = "sp3nd";

export default function Sp3ndPartnerPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [org, setOrg] = useState<{ name: string; logo_url: string | null } | null>(null);
  const [step, setStep] = useState<Step>("url");
  const [cartItems, setCartItems] = useState<Array<{ url: string; quantity: number }>>([{ url: "", quantity: 1 }]);
  const [addMoreUrl, setAddMoreUrl] = useState("");
  const [addMoreQty, setAddMoreQty] = useState(1);
  const [addingMore, setAddingMore] = useState(false);
  const [cartId, setCartId] = useState<string | null>(null);
  const [cartDetails, setCartDetails] = useState<{
    items?: { title?: string; price?: number; quantity?: number }[];
    subtotal?: number;
    total?: number;
    tax?: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [shipping, setShipping] = useState({
    first_name: "",
    last_name: "",
    address_line_1: "",
    address_line_2: "",
    city: "",
    state: "",
    postal_code: "",
    country: "US",
  });
  const [email, setEmail] = useState("");

  useEffect(() => {
    let cancelled = false;
    organizationsApi
      .getByOrganizationId(SP3ND_CHECKOUT_ORG)
      .then((data) => {
        if (!cancelled && data?.organization) {
          setOrg({
            name: data.organization.name || "Sp3nd",
            logo_url: data.organization.logo_url ?? null,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setOrg({ name: "Sp3nd", logo_url: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleAddUrl() {
    const items = cartItems
      .map((i) => ({ url: i.url.trim(), quantity: i.quantity || 1 }))
      .filter((i) => i.url.length > 0);
    if (items.length === 0) {
      toast({ variant: "destructive", title: "Error", description: "Please enter at least one Amazon product URL." });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/partners/sp3nd/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((i) => ({ product_url: i.url, quantity: i.quantity })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to add products");
      }
      const cid = data?.cart?.cart_id || data?.cart_id;
      if (!cid) {
        throw new Error("No cart ID returned");
      }
      setCartId(cid);
      const cart = data?.cart || data;
      setCartDetails({
        items: cart?.items,
        subtotal: cart?.subtotal ?? cart?.total,
        total: cart?.total ?? cart?.subtotal,
        tax: cart?.tax,
      });
      setStep("cart");
      toast({ title: "Added to cart", description: "Confirm your address, then proceed to payment." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e?.message || "Could not add products." });
    } finally {
      setLoading(false);
    }
  }

  async function handleAddMoreItem() {
    const url = addMoreUrl.trim();
    if (!url || !cartId) {
      toast({ variant: "destructive", title: "Error", description: "Please enter an Amazon product URL." });
      return;
    }
    setAddingMore(true);
    try {
      const res = await fetch("/api/partners/sp3nd/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cart_id: cartId,
          product_url: url,
          quantity: addMoreQty || 1,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to add item");
      }
      const cart = data?.cart || data;
      setCartDetails({
        items: cart?.items,
        subtotal: cart?.subtotal ?? cart?.total,
        total: cart?.total ?? cart?.subtotal,
        tax: cart?.tax,
      });
      setAddMoreUrl("");
      setAddMoreQty(1);
      toast({ title: "Item added", description: "Cart updated." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e?.message || "Could not add item." });
    } finally {
      setAddingMore(false);
    }
  }

  async function handleUpdateShipping() {
    if (!cartId) return;
    const required = [shipping.first_name, shipping.last_name, shipping.address_line_1, shipping.city, shipping.postal_code, shipping.country];
    if (required.some((v) => !String(v).trim())) {
      toast({ variant: "destructive", title: "Error", description: "Please fill all required shipping fields." });
      return;
    }
    if (!email.trim()) {
      toast({ variant: "destructive", title: "Error", description: "Please enter your email." });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/partners/sp3nd/shipping", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cart_id: cartId,
          shipping_address: {
            ...shipping,
            first_name: shipping.first_name.trim(),
            last_name: shipping.last_name.trim(),
            address_line_1: shipping.address_line_1.trim(),
            address_line_2: shipping.address_line_2.trim() || undefined,
            city: shipping.city.trim(),
            state: shipping.state.trim() || undefined,
            postal_code: shipping.postal_code.trim(),
            country: shipping.country.trim(),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to update shipping");
      }
      setStep("payment");
      toast({ title: "Address confirmed", description: "Proceed to payment." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e?.message || "Could not update shipping." });
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateOrderAndPay() {
    if (!cartId) return;
    const required = [shipping.first_name, shipping.last_name, shipping.address_line_1, shipping.city, shipping.postal_code, shipping.country];
    if (required.some((v) => !String(v).trim())) {
      toast({ variant: "destructive", title: "Error", description: "Please fill all required shipping fields." });
      return;
    }
    if (!email.trim()) {
      toast({ variant: "destructive", title: "Error", description: "Please enter your email." });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/partners/sp3nd/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cart_id: cartId,
          shipping_address: {
            first_name: shipping.first_name.trim(),
            last_name: shipping.last_name.trim(),
            address_line_1: shipping.address_line_1.trim(),
            address_line_2: shipping.address_line_2.trim() || undefined,
            city: shipping.city.trim(),
            state: shipping.state.trim() || undefined,
            postal_code: shipping.postal_code.trim(),
            country: shipping.country.trim(),
          },
          customer_email: email.trim(),
          test: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to create order");
      }
      const totalAmount = data?.total_amount ?? cartDetails?.total ?? 0;
      const memo = data?.memo || `SP3ND Order: ${data?.order_number}`;
      setStep("redirect");
      const checkoutUrl = `/checkout?organizationId=${encodeURIComponent(SP3ND_CHECKOUT_ORG)}&amount=${encodeURIComponent(String(totalAmount))}&memo=${encodeURIComponent(memo)}`;
      router.push(checkoutUrl);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e?.message || "Could not create order." });
    } finally {
      setLoading(false);
    }
  }

  const totalUsd = cartDetails?.total ?? cartDetails?.subtotal ?? 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-12 md:py-20">
        <Link
          href="/partners"
          className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Partners
        </Link>

        <div className="flex items-center gap-3 mb-8">
          {org?.logo_url ? (
            <div className="relative w-12 h-12 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
              <Image
                src={org.logo_url}
                alt={org.name}
                fill
                className="object-contain"
                sizes="48px"
                unoptimized
              />
            </div>
          ) : (
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(to right, rgba(255,15,0,0.1), rgba(234,179,8,0.1))" }}
            >
              <ShoppingBag className="w-6 h-6 text-orange-600" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl md:text-3xl font-semibold text-slate-900">{org?.name ?? "Sp3nd"}</h1>
            <p className="text-slate-600">Shop Amazon with Stablecoins</p>
            <p className="mt-1 text-sm text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
              <a href="https://sp3nd.shop" target="_blank" rel="noopener noreferrer" className="text-orange-600 hover:text-orange-700 font-medium underline">
                sp3nd.shop
              </a>
              <a href="https://x.com/SP3NDdotshop" target="_blank" rel="noopener noreferrer" className="text-orange-600 hover:text-orange-700 font-medium underline">
                X @SP3NDdotshop
              </a>
            </p>
          </div>
        </div>

        {step === "url" && (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 md:p-8 shadow-sm">
            <p className="text-slate-600 mb-4">
              Paste Amazon product URL(s) below. Add as many as you like, then add all to cart. Pay with USDC or other stablecoins via Loofta Pay.
            </p>
            <div className="space-y-4">
              {cartItems.map((item, index) => (
                <div key={index} className="flex flex-col sm:flex-row gap-3 items-start sm:items-end border-b border-gray-100 pb-4 last:border-0 last:pb-0">
                  <div className="flex-1 w-full min-w-0">
                    <Label>Amazon product URL {cartItems.length > 1 ? `#${index + 1}` : ""}</Label>
                    <Input
                      type="url"
                      placeholder="https://www.amazon.com/dp/..."
                      value={item.url}
                      onChange={(e) =>
                        setCartItems((prev) =>
                          prev.map((p, i) => (i === index ? { ...p, url: e.target.value } : p))
                        )
                      }
                      className="mt-1"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <div>
                      <Label>Qty</Label>
                      <Input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) =>
                          setCartItems((prev) =>
                            prev.map((p, i) =>
                              i === index ? { ...p, quantity: parseInt(e.target.value, 10) || 1 } : p
                            )
                          )
                        }
                        className="mt-1 w-16"
                      />
                    </div>
                    {cartItems.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 mt-6"
                        onClick={() =>
                          setCartItems((prev) => prev.filter((_, i) => i !== index))
                        }
                      >
                        ×
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => setCartItems((prev) => [...prev, { url: "", quantity: 1 }])}
              >
                + Add another product
              </Button>
              <Button
                onClick={handleAddUrl}
                disabled={loading}
                className="w-full mt-4"
                style={{ background: "linear-gradient(to right, #FF0F00, #EAB308)" }}
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Add to cart & continue"}
              </Button>
            </div>
          </div>
        )}

        {step === "cart" && cartId && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-gray-200 bg-white p-6 md:p-8 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Your cart</h2>
              {cartDetails?.items?.length ? (
                <ul className="space-y-2 mb-4">
                  {cartDetails.items.map((item: any, i: number) => (
                    <li key={i} className="flex justify-between text-sm">
                      <span className="text-slate-700 truncate max-w-[200px]">{item?.title || "Item"}</span>
                      <span className="text-slate-900 font-medium">
                        ${typeof item?.price === "number" ? item.price.toFixed(2) : "—"} × {item?.quantity ?? 1}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-slate-600 text-sm mb-4">Cart loaded. Total below.</p>
              )}
              <div className="border-t border-gray-200 pt-4 flex justify-between text-lg font-semibold text-slate-900">
                <span>Total (USD)</span>
                <span>${typeof totalUsd === "number" ? totalUsd.toFixed(2) : "0.00"}</span>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-6 md:p-8 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Step 1: Confirm shipping address</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>First name *</Label>
                  <Input
                    value={shipping.first_name}
                    onChange={(e) => setShipping((s) => ({ ...s, first_name: e.target.value }))}
                    placeholder="Jane"
                  />
                </div>
                <div>
                  <Label>Last name *</Label>
                  <Input
                    value={shipping.last_name}
                    onChange={(e) => setShipping((s) => ({ ...s, last_name: e.target.value }))}
                    placeholder="Doe"
                  />
                </div>
              </div>
              <div className="mt-4">
                <Label>Address line 1 *</Label>
                <Input
                  value={shipping.address_line_1}
                  onChange={(e) => setShipping((s) => ({ ...s, address_line_1: e.target.value }))}
                  placeholder="123 Main St"
                />
              </div>
              <div className="mt-4">
                <Label>Address line 2 (optional)</Label>
                <Input
                  value={shipping.address_line_2}
                  onChange={(e) => setShipping((s) => ({ ...s, address_line_2: e.target.value }))}
                  placeholder="Apt 4"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
                <div>
                  <Label>City *</Label>
                  <Input
                    value={shipping.city}
                    onChange={(e) => setShipping((s) => ({ ...s, city: e.target.value }))}
                    placeholder="New York"
                  />
                </div>
                <div>
                  <Label>State / Province</Label>
                  <Input
                    value={shipping.state}
                    onChange={(e) => setShipping((s) => ({ ...s, state: e.target.value }))}
                    placeholder="NY"
                  />
                </div>
                <div>
                  <Label>Postal code *</Label>
                  <Input
                    value={shipping.postal_code}
                    onChange={(e) => setShipping((s) => ({ ...s, postal_code: e.target.value }))}
                    placeholder="10001"
                  />
                </div>
              </div>
              <div className="mt-4">
                <Label>Country *</Label>
                <Input
                  value={shipping.country}
                  onChange={(e) => setShipping((s) => ({ ...s, country: e.target.value }))}
                  placeholder="US"
                />
              </div>
              <div className="mt-4">
                <Label>Email *</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-6 md:p-8 shadow-sm">
              <h3 className="text-base font-semibold text-slate-900 mb-3">Add another item</h3>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 min-w-0">
                  <Label className="sr-only">Amazon product URL</Label>
                  <Input
                    type="url"
                    placeholder="https://www.amazon.com/dp/..."
                    value={addMoreUrl}
                    onChange={(e) => setAddMoreUrl(e.target.value)}
                    className="mt-0"
                  />
                </div>
                <div className="w-20">
                  <Label className="sr-only">Quantity</Label>
                  <Input
                    type="number"
                    min={1}
                    value={addMoreQty}
                    onChange={(e) => setAddMoreQty(parseInt(e.target.value, 10) || 1)}
                    className="mt-0"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={addingMore || !addMoreUrl.trim()}
                  onClick={handleAddMoreItem}
                  className="sm:mt-0"
                >
                  {addingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add"}
                </Button>
              </div>
            </div>

            <Button
              onClick={handleUpdateShipping}
              disabled={loading}
              className="w-full"
              style={{ background: "linear-gradient(to right, #FF0F00, #EAB308)", color: "#fff" }}
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Confirm address & continue"}
            </Button>
          </div>
        )}

        {step === "payment" && cartId && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-gray-200 bg-white p-6 md:p-8 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900 mb-2">Step 2: Proceed to payment</h2>
              <p className="text-slate-600 mb-4">
                Your shipping address is confirmed. Click below to complete your order and pay with USDC or other stablecoins via Loofta Pay.
              </p>
              <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 text-sm text-slate-700 mb-4">
                <p className="font-medium text-slate-900 mb-2">Shipping to</p>
                <p>
                  {shipping.first_name} {shipping.last_name}
                </p>
                <p>
                  {shipping.address_line_1}
                  {shipping.address_line_2 ? `, ${shipping.address_line_2}` : ""}
                </p>
                <p>
                  {shipping.city}
                  {shipping.state ? `, ${shipping.state}` : ""} {shipping.postal_code}
                </p>
                <p>{shipping.country}</p>
                <p className="mt-2 text-slate-600">{email}</p>
              </div>
              <Button
                onClick={handleCreateOrderAndPay}
                disabled={loading}
                className="w-full"
                style={{ background: "linear-gradient(to right, #FF0F00, #EAB308)" }}
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : `Proceed to payment — $${typeof totalUsd === "number" ? totalUsd.toFixed(2) : "0.00"}`}
              </Button>
            </div>
          </div>
        )}

        {step === "redirect" && (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
            <Loader2 className="w-12 h-12 animate-spin text-orange-500 mx-auto mb-4" />
            <p className="text-slate-700">Redirecting to checkout…</p>
            <p className="text-sm text-slate-500 mt-2">If you’re not redirected, use the link below.</p>
            <Link
              href={`/checkout?organizationId=${SP3ND_CHECKOUT_ORG}&amount=${totalUsd}&memo=SP3ND%20Order`}
              className="inline-block mt-4 text-orange-600 font-medium hover:underline"
            >
              Open checkout
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
