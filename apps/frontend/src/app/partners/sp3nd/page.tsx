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

type Step = "url" | "cart" | "shipping" | "redirect";

const SP3ND_CHECKOUT_ORG = "sp3nd";

export default function Sp3ndPartnerPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [org, setOrg] = useState<{ name: string; logo_url: string | null } | null>(null);
  const [step, setStep] = useState<Step>("url");
  const [productUrl, setProductUrl] = useState("");
  const [quantity, setQuantity] = useState(1);
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
    const url = productUrl.trim();
    if (!url) {
      toast({ variant: "destructive", title: "Error", description: "Please enter an Amazon product URL." });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/partners/sp3nd/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_url: url, quantity: quantity || 1 }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to add product");
      }
      const cid = data?.cart?.cart_id || data?.cart_id;
      if (!cid) {
        throw new Error("No cart ID returned");
      }
      setCartId(cid);
      const cartRes = await fetch("/api/partners/sp3nd/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cart_id: cid }),
      });
      const cartData = await cartRes.json();
      const cart = cartData?.cart || cartData;
      setCartDetails({
        items: cart?.items,
        subtotal: cart?.subtotal ?? cart?.total,
        total: cart?.total ?? cart?.subtotal,
        tax: cart?.tax,
      });
      setStep("cart");
      toast({ title: "Added to cart", description: "Review your cart and proceed to shipping." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e?.message || "Could not add product." });
    } finally {
      setLoading(false);
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
      setStep("shipping");
      toast({ title: "Shipping updated", description: "Confirm and pay." });
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
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold text-slate-900">{org?.name ?? "Sp3nd"}</h1>
            <p className="text-slate-600">Shop Amazon with Stablecoins</p>
          </div>
        </div>

        {step === "url" && (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 md:p-8 shadow-sm">
            <p className="text-slate-600 mb-4">
              Paste any Amazon product URL below. We’ll fetch the product and you can pay with USDC or other stablecoins via Loofta Pay.
            </p>
            <div className="space-y-4">
              <div>
                <Label htmlFor="product_url">Amazon product URL</Label>
                <Input
                  id="product_url"
                  type="url"
                  placeholder="https://www.amazon.com/dp/..."
                  value={productUrl}
                  onChange={(e) => setProductUrl(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="quantity">Quantity</Label>
                <Input
                  id="quantity"
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 1)}
                  className="mt-1 w-24"
                />
              </div>
              <Button
                onClick={handleAddUrl}
                disabled={loading}
                className="w-full"
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
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Shipping address</h2>
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
              <Button
                onClick={handleUpdateShipping}
                disabled={loading}
                className="w-full mt-6"
                variant="outline"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Update shipping & continue"}
              </Button>
            </div>

            <Button
              onClick={handleCreateOrderAndPay}
              disabled={loading}
              className="w-full"
              style={{ background: "linear-gradient(to right, #FF0F00, #EAB308)" }}
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : `Pay $${typeof totalUsd === "number" ? totalUsd.toFixed(2) : "0.00"} with Loofta Pay`}
            </Button>
          </div>
        )}

        {step === "shipping" && cartId && (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 md:p-8 shadow-sm">
            <p className="text-slate-600 mb-4">Shipping updated. Click below to create your order and pay with USDC/stablecoins.</p>
            <Button
              onClick={handleCreateOrderAndPay}
              disabled={loading}
              className="w-full"
              style={{ background: "linear-gradient(to right, #FF0F00, #EAB308)" }}
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : `Pay $${typeof totalUsd === "number" ? totalUsd.toFixed(2) : "0.00"} with Loofta Pay`}
            </Button>
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
