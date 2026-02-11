"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Loader2, ArrowLeft, ShoppingBag, Check, ChevronsUpDown } from "lucide-react";
import { organizationsApi } from "@/services/api/organizations";
import { cn } from "@/lib/utils";
import { useSp3ndStore, type Sp3ndStep } from "@/store/sp3nd";

const SP3ND_LAST_CART_KEY = "sp3nd_last_cart";

const SP3ND_CHECKOUT_ORG = "sp3nd";

/** Common countries for shipping (code + full name for API). */
const COUNTRY_OPTIONS: { code: string; name: string }[] = [
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "GB", name: "United Kingdom" },
  { code: "AU", name: "Australia" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "NL", name: "Netherlands" },
  { code: "BE", name: "Belgium" },
  { code: "AT", name: "Austria" },
  { code: "CH", name: "Switzerland" },
  { code: "IE", name: "Ireland" },
  { code: "PT", name: "Portugal" },
  { code: "PL", name: "Poland" },
  { code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },
  { code: "DK", name: "Denmark" },
  { code: "FI", name: "Finland" },
  { code: "JP", name: "Japan" },
  { code: "MX", name: "Mexico" },
  { code: "BR", name: "Brazil" },
  { code: "IN", name: "India" },
  { code: "CN", name: "China" },
  { code: "KR", name: "South Korea" },
  { code: "NZ", name: "New Zealand" },
  { code: "SG", name: "Singapore" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "IL", name: "Israel" },
  { code: "ZA", name: "South Africa" },
  { code: "OTHER", name: "Other" },
];

/** Phone dial codes for country code selector. */
const PHONE_DIAL_CODES: { dialCode: string; label: string }[] = [
  { dialCode: "+1", label: "+1 (US/CA)" },
  { dialCode: "+44", label: "+44 (UK)" },
  { dialCode: "+61", label: "+61 (AU)" },
  { dialCode: "+49", label: "+49 (DE)" },
  { dialCode: "+33", label: "+33 (FR)" },
  { dialCode: "+34", label: "+34 (ES)" },
  { dialCode: "+39", label: "+39 (IT)" },
  { dialCode: "+31", label: "+31 (NL)" },
  { dialCode: "+32", label: "+32 (BE)" },
  { dialCode: "+43", label: "+43 (AT)" },
  { dialCode: "+41", label: "+41 (CH)" },
  { dialCode: "+353", label: "+353 (IE)" },
  { dialCode: "+351", label: "+351 (PT)" },
  { dialCode: "+48", label: "+48 (PL)" },
  { dialCode: "+46", label: "+46 (SE)" },
  { dialCode: "+47", label: "+47 (NO)" },
  { dialCode: "+45", label: "+45 (DK)" },
  { dialCode: "+358", label: "+358 (FI)" },
  { dialCode: "+81", label: "+81 (JP)" },
  { dialCode: "+52", label: "+52 (MX)" },
  { dialCode: "+55", label: "+55 (BR)" },
  { dialCode: "+91", label: "+91 (IN)" },
  { dialCode: "+86", label: "+86 (CN)" },
  { dialCode: "+82", label: "+82 (KR)" },
  { dialCode: "+64", label: "+64 (NZ)" },
  { dialCode: "+65", label: "+65 (SG)" },
  { dialCode: "+971", label: "+971 (AE)" },
  { dialCode: "+972", label: "+972 (IL)" },
  { dialCode: "+27", label: "+27 (ZA)" },
];

export default function Sp3ndPartnerPage() {
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const step = useSp3ndStore((s) => s.step);
  const lastOrderNumber = useSp3ndStore((s) => s.lastOrderNumber);
  const cartItems = useSp3ndStore((s) => s.cartItems);
  const addMoreUrl = useSp3ndStore((s) => s.addMoreUrl);
  const addMoreQty = useSp3ndStore((s) => s.addMoreQty);
  const cartId = useSp3ndStore((s) => s.cartId);
  const cartDetails = useSp3ndStore((s) => s.cartDetails);
  const shipping = useSp3ndStore((s) => s.shipping);
  const email = useSp3ndStore((s) => s.email);
  const hydrated = useSp3ndStore((s) => s.hydrated);
  const setStep = useSp3ndStore((s) => s.setStep);
  const setLastOrderNumber = useSp3ndStore((s) => s.setLastOrderNumber);
  const setCartItems = useSp3ndStore((s) => s.setCartItems);
  const setCartItemsBy = useSp3ndStore((s) => s.setCartItemsBy);
  const setAddMoreUrl = useSp3ndStore((s) => s.setAddMoreUrl);
  const setAddMoreQty = useSp3ndStore((s) => s.setAddMoreQty);
  const setCartId = useSp3ndStore((s) => s.setCartId);
  const setCartDetails = useSp3ndStore((s) => s.setCartDetails);
  const setShipping = useSp3ndStore((s) => s.setShipping);
  const setEmail = useSp3ndStore((s) => s.setEmail);
  const resetOrder = useSp3ndStore((s) => s.resetOrder);

  const [org, setOrg] = useState<{ name: string; logo_url: string | null } | null>(null);
  const [addingMore, setAddingMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dialCodeOpen, setDialCodeOpen] = useState(false);

  /** Build shipping_address payload with all fields for API (trimmed; optional fields only when set). */
  function getShippingAddressPayload() {
    const fullPhone = (shipping.phoneCountryCode + shipping.phone.replace(/\D/g, "")).trim();
    return {
      first_name: shipping.first_name.trim(),
      last_name: shipping.last_name.trim(),
      address_line_1: shipping.address_line_1.trim(),
      ...(shipping.address_line_2.trim() ? { address_line_2: shipping.address_line_2.trim() } : {}),
      city: shipping.city.trim(),
      ...(shipping.state.trim() ? { state: shipping.state.trim() } : {}),
      postal_code: shipping.postal_code.trim(),
      country: shipping.country.trim(),
      phone: fullPhone || shipping.phone.trim(),
    };
  }

  const isLocalhost = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

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

  // When returning from checkout success callback, show paid step and restore basket from localStorage
  useEffect(() => {
    const payment = searchParams.get("payment");
    const order = searchParams.get("order");
    if (payment === "success" && order?.trim()) {
      setLastOrderNumber(order.trim());
      try {
        const raw = typeof window !== "undefined" ? localStorage.getItem(SP3ND_LAST_CART_KEY) : null;
        if (raw) {
          const parsed = JSON.parse(raw) as { orderNumber?: string; cartDetails?: typeof cartDetails; totalUsd?: number };
          if (parsed.cartDetails) setCartDetails(parsed.cartDetails);
        }
      } catch {
        // ignore
      }
      setStep("paid");
    }
  }, [searchParams]);

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
        items: cart?.items ?? [],
        subtotal: cart?.subtotal ?? cart?.total,
        total: cart?.total ?? cart?.subtotal ?? cart?.total_amount,
        tax: cart?.tax ?? cart?.tax_amount,
        tax_amount: cart?.tax_amount ?? cart?.tax,
        shipping_amount: cart?.shipping_amount ?? 0,
        platform_fee: cart?.platform_fee,
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
        items: cart?.items ?? [],
        subtotal: cart?.subtotal ?? cart?.total,
        total: cart?.total ?? cart?.subtotal ?? cart?.total_amount,
        tax: cart?.tax ?? cart?.tax_amount,
        tax_amount: cart?.tax_amount ?? cart?.tax,
        shipping_amount: cart?.shipping_amount ?? 0,
        platform_fee: cart?.platform_fee,
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
    const required = [shipping.first_name, shipping.last_name, shipping.address_line_1, shipping.city, shipping.postal_code, shipping.country, shipping.phone];
    if (required.some((v) => !String(v).trim())) {
      toast({ variant: "destructive", title: "Error", description: "Please fill all required shipping fields (including phone)." });
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
          shipping_address: getShippingAddressPayload(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to update shipping");
      }
      const cart = data?.cart || data;
      if (cart && (cart.subtotal != null || cart.total_amount != null)) {
        setCartDetails({
          items: cart?.items ?? cartDetails?.items ?? [],
          subtotal: cart?.subtotal ?? cart?.total,
          total: cart?.total ?? cart?.subtotal ?? cart?.total_amount,
          tax: cart?.tax ?? cart?.tax_amount,
          tax_amount: cart?.tax_amount ?? cart?.tax,
          shipping_amount: cart?.shipping_amount ?? 0,
          platform_fee: cart?.platform_fee,
        });
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
    const required = [shipping.first_name, shipping.last_name, shipping.address_line_1, shipping.city, shipping.postal_code, shipping.country, shipping.phone];
    if (required.some((v) => !String(v).trim())) {
      toast({ variant: "destructive", title: "Error", description: "Please fill all required shipping fields (including phone)." });
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
          shipping_address: getShippingAddressPayload(),
          customer_email: email.trim(),
          test: isLocalhost,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to create order");
      }
      const totalAmount = data?.total_amount ?? cartDetails?.total ?? 0;
      const memo = data?.memo || `SP3ND Order: ${data?.order_number}`;
      const orderNumber = data?.order_number ?? "";
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const returnUrl = `${origin}/partners/sp3nd?payment=success&order=${encodeURIComponent(orderNumber)}`;
      const checkoutUrl = `/checkout?organizationId=${encodeURIComponent(SP3ND_CHECKOUT_ORG)}&amount=${encodeURIComponent(String(totalAmount))}&memo=${encodeURIComponent(memo)}&callback=${encodeURIComponent(returnUrl)}`;
      try {
        localStorage.setItem(
          SP3ND_LAST_CART_KEY,
          JSON.stringify({ orderNumber, cartDetails, totalUsd: totalUsd })
        );
      } catch {
        // ignore
      }
      window.open(checkoutUrl, "_blank");
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e?.message || "Could not create order." });
    } finally {
      setLoading(false);
    }
  }

  // Total = sum of breakdown so display always matches (API may return total as item-only)
  const subtotalNum = cartDetails?.subtotal ?? 0;
  const shippingNum = cartDetails?.shipping_amount ?? 0;
  const taxNum = cartDetails?.tax_amount ?? 0;
  const platformFeeNum = cartDetails?.platform_fee ?? 0;
  const totalFromBreakdown = subtotalNum + shippingNum + taxNum + platformFeeNum;
  const totalUsd =
    totalFromBreakdown > 0
      ? totalFromBreakdown
      : (cartDetails?.total ?? cartDetails?.subtotal ?? 0);

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
            <div className="w-24 h-24 p-3 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0 flex items-center justify-center">
              <div className="relative w-full h-full">
                <Image
                  src={org.logo_url}
                  alt={org.name}
                  fill
                  className="object-contain"
                  sizes="48px"
                  unoptimized
                />
              </div>
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

        {!hydrated ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-slate-400 mx-auto mb-2" />
            <p className="text-slate-600 text-sm">Loading…</p>
          </div>
        ) : (
        <>
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
                        setCartItemsBy((prev) =>
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
                          setCartItemsBy((prev) =>
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
                          setCartItemsBy((prev) => prev.filter((_, i) => i !== index))
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
                onClick={() => setCartItemsBy((prev) => [...prev, { url: "", quantity: 1 }])}
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
                <ul className="space-y-3 mb-4">
                  {cartDetails.items.map((item: any, i: number) => (
                    <li key={item?.product_id ?? i} className="flex gap-3 items-center text-sm border-b border-gray-100 pb-3 last:border-0 last:pb-0">
                      {item?.image_url ? (
                        <div className="relative shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-gray-100">
                          <Image
                            src={item.image_url}
                            alt={item?.product_title || item?.title || "Product"}
                            fill
                            className="object-contain"
                            sizes="56px"
                          />
                        </div>
                      ) : (
                        <div className="shrink-0 w-14 h-14 rounded-lg bg-gray-100 flex items-center justify-center">
                          <ShoppingBag className="w-6 h-6 text-gray-400" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="text-slate-700 line-clamp-2">{item?.product_title || item?.title || "Item"}</span>
                        <span className="text-slate-500 text-xs mt-0.5 block">
                          ${typeof item?.price === "number" ? item.price.toFixed(2) : "—"} × {item?.quantity ?? 1}
                        </span>
                      </div>
                      <span className="text-slate-900 font-medium shrink-0">
                        ${typeof item?.price === "number" && typeof item?.quantity === "number" ? (item.price * item.quantity).toFixed(2) : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-slate-600 text-sm mb-4">Cart loaded. Total below.</p>
              )}
              <div className="border-t border-gray-200 pt-4 space-y-2 text-sm">
                {typeof cartDetails?.subtotal === "number" && (
                  <div className="flex justify-between text-slate-600">
                    <span>Subtotal</span>
                    <span>${cartDetails.subtotal.toFixed(2)}</span>
                  </div>
                )}
                {typeof cartDetails?.shipping_amount === "number" && (
                  <div className="flex justify-between text-slate-600">
                    <span>Shipping</span>
                    <span>${cartDetails.shipping_amount.toFixed(2)}</span>
                  </div>
                )}
                {typeof cartDetails?.tax_amount === "number" && cartDetails.tax_amount > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Tax</span>
                    <span>${cartDetails.tax_amount.toFixed(2)}</span>
                  </div>
                )}
                {typeof cartDetails?.platform_fee === "number" && cartDetails.platform_fee > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Platform fee</span>
                    <span>${cartDetails.platform_fee.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-semibold text-slate-900 pt-2 border-t border-gray-100">
                  <span>Total (USD)</span>
                  <span>${typeof totalUsd === "number" ? totalUsd.toFixed(2) : "0.00"}</span>
                </div>
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
                <Select
                  value={shipping.country}
                  onValueChange={(value) => setShipping((s) => ({ ...s, country: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select country" />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRY_OPTIONS.map((c) => (
                      <SelectItem key={c.code} value={c.name}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="mt-4">
                <Label>Phone *</Label>
                <div className="flex gap-2">
                  <Popover open={dialCodeOpen} onOpenChange={setDialCodeOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        className={cn(
                          "w-[140px] shrink-0 justify-between font-normal",
                          !shipping.phoneCountryCode && "text-muted-foreground"
                        )}
                      >
                        {shipping.phoneCountryCode
                          ? PHONE_DIAL_CODES.find((p) => p.dialCode === shipping.phoneCountryCode)?.label ?? shipping.phoneCountryCode
                          : "Dial code"}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[240px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search code or country (e.g. +1, US, UK)..." />
                        <CommandList>
                          <CommandEmpty>No dial code found.</CommandEmpty>
                          <CommandGroup>
                            {PHONE_DIAL_CODES.map((p) => (
                              <CommandItem
                                key={p.dialCode}
                                value={`${p.dialCode} ${p.label}`}
                                onSelect={() => {
                                  setShipping((s) => ({ ...s, phoneCountryCode: p.dialCode }));
                                  setDialCodeOpen(false);
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    shipping.phoneCountryCode === p.dialCode ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                {p.label}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <Input
                    type="tel"
                    value={shipping.phone}
                    onChange={(e) => setShipping((s) => ({ ...s, phone: e.target.value }))}
                    placeholder="555 123 4567"
                    className="flex-1"
                  />
                </div>
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
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Your basket</h2>
              {cartDetails?.items?.length ? (
                <ul className="space-y-3 mb-4">
                  {(cartDetails.items ?? []).map((item: any, i: number) => (
                    <li key={item?.product_id ?? i} className="flex gap-3 items-center text-sm border-b border-gray-100 pb-3 last:border-0 last:pb-0">
                      {item?.image_url ? (
                        <div className="relative shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-gray-100">
                          <Image
                            src={item.image_url}
                            alt={item?.product_title || item?.title || "Product"}
                            fill
                            className="object-contain"
                            sizes="56px"
                          />
                        </div>
                      ) : (
                        <div className="shrink-0 w-14 h-14 rounded-lg bg-gray-100 flex items-center justify-center">
                          <ShoppingBag className="w-6 h-6 text-gray-400" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="text-slate-700 line-clamp-2">{item?.product_title || item?.title || "Item"}</span>
                        <span className="text-slate-500 text-xs mt-0.5 block">
                          ${typeof item?.price === "number" ? item.price.toFixed(2) : "—"} × {item?.quantity ?? 1}
                        </span>
                      </div>
                      <span className="text-slate-900 font-medium shrink-0">
                        ${typeof item?.price === "number" && typeof item?.quantity === "number" ? (item.price * item.quantity).toFixed(2) : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-slate-600 text-sm mb-4">Cart loaded. Total below.</p>
              )}
              <div className="border-t border-gray-200 pt-4 space-y-2 text-sm">
                {typeof cartDetails?.subtotal === "number" && (
                  <div className="flex justify-between text-slate-600">
                    <span>Subtotal</span>
                    <span>${cartDetails.subtotal.toFixed(2)}</span>
                  </div>
                )}
                {typeof cartDetails?.shipping_amount === "number" && (
                  <div className="flex justify-between text-slate-600">
                    <span>Shipping</span>
                    <span>${cartDetails.shipping_amount.toFixed(2)}</span>
                  </div>
                )}
                {typeof cartDetails?.tax_amount === "number" && cartDetails.tax_amount > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Tax</span>
                    <span>${cartDetails.tax_amount.toFixed(2)}</span>
                  </div>
                )}
                {typeof cartDetails?.platform_fee === "number" && cartDetails.platform_fee > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Platform fee</span>
                    <span>${cartDetails.platform_fee.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-semibold text-slate-900 pt-2 border-t border-gray-100">
                  <span>Total (USD)</span>
                  <span>${typeof totalUsd === "number" ? totalUsd.toFixed(2) : "0.00"}</span>
                </div>
              </div>
            </div>

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
                {(shipping.phoneCountryCode || shipping.phone) ? (
                  <p>{shipping.phoneCountryCode}{shipping.phone.replace(/\D/g, "")}</p>
                ) : null}
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
              <Button
                type="button"
                variant="ghost"
                className="w-full mt-3 text-slate-600 hover:text-slate-900"
                onClick={() => setStep("cart")}
              >
                <ArrowLeft className="w-4 h-4 mr-2 inline" />
                Go back to address
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

        {step === "paid" && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-green-200 bg-green-50/50 p-6 md:p-8 text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-green-100 text-green-600 mb-4">
                <Check className="w-8 h-8" />
              </div>
              <h2 className="text-xl font-semibold text-slate-900 mb-1">Payment successful</h2>
              <p className="text-slate-700">
                Order <span className="font-mono font-medium">{lastOrderNumber || "—"}</span> has been paid.
              </p>
            </div>
            {cartDetails && (cartDetails.items?.length ?? 0) > 0 && (
              <div className="rounded-2xl border border-gray-200 bg-white p-6 md:p-8">
                <h2 className="text-lg font-semibold text-slate-900 mb-4">Order summary</h2>
                <ul className="space-y-3 mb-4">
                  {(cartDetails.items ?? []).map((item: any, i: number) => (
                    <li key={item?.product_id ?? i} className="flex gap-3 items-center text-sm border-b border-gray-100 pb-3 last:border-0 last:pb-0">
                      {item?.image_url ? (
                        <div className="relative shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-gray-100">
                          <Image
                            src={item.image_url}
                            alt={item?.product_title || item?.title || "Product"}
                            fill
                            className="object-contain"
                            sizes="56px"
                          />
                        </div>
                      ) : (
                        <div className="shrink-0 w-14 h-14 rounded-lg bg-gray-100 flex items-center justify-center">
                          <ShoppingBag className="w-6 h-6 text-gray-400" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="text-slate-700 line-clamp-2">{item?.product_title || item?.title || "Item"}</span>
                        <span className="text-slate-500 text-xs mt-0.5 block">
                          ${typeof item?.price === "number" ? item.price.toFixed(2) : "—"} × {item?.quantity ?? 1}
                        </span>
                      </div>
                      <span className="text-slate-900 font-medium shrink-0">
                        ${typeof item?.price === "number" && typeof item?.quantity === "number" ? (item.price * item.quantity).toFixed(2) : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="border-t border-gray-200 pt-4 space-y-2 text-sm">
                  {typeof cartDetails?.subtotal === "number" && (
                    <div className="flex justify-between text-slate-600">
                      <span>Subtotal</span>
                      <span>${cartDetails.subtotal.toFixed(2)}</span>
                    </div>
                  )}
                  {typeof cartDetails?.shipping_amount === "number" && (
                    <div className="flex justify-between text-slate-600">
                      <span>Shipping</span>
                      <span>${cartDetails.shipping_amount.toFixed(2)}</span>
                    </div>
                  )}
                  {typeof cartDetails?.tax_amount === "number" && cartDetails.tax_amount > 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>Tax</span>
                      <span>${cartDetails.tax_amount.toFixed(2)}</span>
                    </div>
                  )}
                  {typeof cartDetails?.platform_fee === "number" && cartDetails.platform_fee > 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>Platform fee</span>
                      <span>${cartDetails.platform_fee.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-lg font-semibold text-slate-900 pt-2 border-t border-gray-100">
                    <span>Total (USD)</span>
                    <span>${typeof totalUsd === "number" ? totalUsd.toFixed(2) : "0.00"}</span>
                  </div>
                </div>
              </div>
            )}
            <Button
              onClick={() => {
                try {
                  localStorage.removeItem(SP3ND_LAST_CART_KEY);
                } catch {
                  // ignore
                }
                resetOrder();
                router.replace("/partners/sp3nd");
              }}
              className="w-full"
              style={{ background: "linear-gradient(to right, #FF0F00, #EAB308)" }}
            >
              Start new order
            </Button>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}
