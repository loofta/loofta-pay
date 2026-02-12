"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { payrollApi, type PayrollContributor, type UpdateContributorProfileDto } from "@/services/api/payroll";
import { Loader2, ArrowLeft, ShieldCheck, Building2, MapPin, User, Check, Wallet } from "lucide-react";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import { TokenCombobox } from "@/components/TokenCombobox";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { id: "name", label: "Name", icon: User },
  { id: "address", label: "Address", icon: MapPin },
  { id: "business", label: "Business", icon: Building2 },
  { id: "payout", label: "Payout", icon: Wallet },
  { id: "kyc", label: "KYC", icon: ShieldCheck },
] as const;

const inputClass = "mt-1.5 min-h-[44px] sm:min-h-[40px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

export default function YourProfilePage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const { authenticated, userId, ready } = useAuth();
  const { toast } = useToast();
  const [profile, setProfile] = useState<PayrollContributor | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessRegistrationNumber, setBusinessRegistrationNumber] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [network, setNetwork] = useState<string | null>(null);
  const [tokenSymbol, setTokenSymbol] = useState<string | null>(null);
  const { data: tokens = [] } = useTokensQuery();

  const loadProfile = useCallback(async () => {
    if (!orgId || !userId) return;
    try {
      setLoading(true);
      const data = await payrollApi.contributors.getMe(orgId, userId);
      setProfile(data);
      setFirstName(data.first_name ?? "");
      setLastName(data.last_name ?? "");
      setAddressLine1(data.address_line1 ?? "");
      setAddressLine2(data.address_line2 ?? "");
      setCity(data.city ?? "");
      setState(data.state ?? "");
      setPostalCode(data.postal_code ?? "");
      setCountry(data.country ?? "");
      setBusinessName(data.business_name ?? "");
      setBusinessRegistrationNumber(data.business_registration_number ?? "");
      setWalletAddress(data.wallet_address ?? "");
      setNetwork(data.network ?? null);
      setTokenSymbol(data.token_symbol ?? null);
    } catch {
      toast({ variant: "destructive", title: "Access denied", description: "You are not a contributor in this organization." });
    } finally {
      setLoading(false);
    }
  }, [orgId, userId, toast]);

  useEffect(() => {
    if (ready && authenticated && orgId && userId) loadProfile();
  }, [ready, authenticated, orgId, userId, loadProfile]);

  useEffect(() => {
    if (!profile) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 }
    );
    SECTIONS.forEach(({ id }) => {
      const el = sectionRefs.current[id];
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [profile]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !orgId) return;
    setSaving(true);
    try {
      const dto: UpdateContributorProfileDto = {
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        addressLine1: addressLine1.trim() || undefined,
        addressLine2: addressLine2.trim() || undefined,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        postalCode: postalCode.trim() || undefined,
        country: country.trim() || undefined,
        businessName: businessName.trim() || undefined,
        businessRegistrationNumber: businessRegistrationNumber.trim() || undefined,
        walletAddress: walletAddress.trim() || undefined,
        network: network ?? undefined,
        tokenSymbol: tokenSymbol ?? undefined,
      };
      const updated = await payrollApi.contributors.updateMe(orgId, dto, userId);
      setProfile(updated);
      toast({ title: "Saved", description: "Your contributor information has been updated." });
    } catch (err: unknown) {
      toast({
        variant: "destructive",
        title: "Failed to save",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!ready || !authenticated) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (loading && !profile) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/payroll/${orgId}/deals`}><ArrowLeft className="h-4 w-4 mr-2" /> Back</Link>
        </Button>
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-8 text-center text-amber-800">
            You don’t have access to contributor info for this organization.
          </CardContent>
        </Card>
      </div>
    );
  }

  const kycStatus = profile.kyc_status || "not_started";
  const isKycVerified = kycStatus === "verified";

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="shrink-0" asChild>
          <Link href={`/payroll/${orgId}/deals`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-gray-900">Your profile</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Name, address, business details, and KYC. Easy to edit on mobile and desktop.
          </p>
        </div>
      </div>

      {/* Anchor tabs — sections + KYC status at a glance */}
      <nav
        className="sticky top-[3.5rem] z-10 -mx-1 flex gap-1 overflow-x-auto rounded-lg border border-gray-200 bg-white/95 p-1 shadow-sm backdrop-blur sm:top-14"
        aria-label="Profile sections"
      >
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <a
            key={id}
            href={`#${id}`}
            onClick={(e) => {
              e.preventDefault();
              sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className={cn(
              "flex min-w-0 shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              activeSection === id
                ? "bg-gray-100 text-gray-900"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            )}
          >
            <Icon className="h-4 w-4 shrink-0 text-gray-500" />
            <span>{label}</span>
            {id === "kyc" && (
              <span
                className={cn(
                  "ml-1 rounded-full px-1.5 py-0.5 text-xs font-medium",
                  isKycVerified ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                )}
              >
                {isKycVerified ? "Verified" : "Not verified"}
              </span>
            )}
          </a>
        ))}
      </nav>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Name */}
        <Card id="name" ref={(el) => { sectionRefs.current.name = el; }} className="border-gray-200 bg-white overflow-hidden scroll-mt-24">
          <CardHeader className="px-6 pt-6 pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <User className="h-5 w-5 text-gray-600" />
              Name
            </CardTitle>
            <CardDescription className="mt-1">Your first and last name as shown to the organization.</CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-6 pt-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">First name</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                  className={inputClass}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Last name</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                  className={inputClass}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Address */}
        <Card id="address" ref={(el) => { sectionRefs.current.address = el; }} className="border-gray-200 bg-white overflow-hidden scroll-mt-24">
          <CardHeader className="px-6 pt-6 pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <MapPin className="h-5 w-5 text-gray-600" />
              Address
            </CardTitle>
            <CardDescription className="mt-1">Your billing or contact address.</CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-6 pt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="address1">Address line 1</Label>
              <Input
                id="address1"
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
                placeholder="Street, number"
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="address2">Address line 2</Label>
              <Input
                id="address2"
                value={addressLine2}
                onChange={(e) => setAddressLine2(e.target.value)}
                placeholder="Apt, suite, etc."
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="city">City</Label>
                <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" className={inputClass} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="state">State / Region</Label>
                <Input id="state" value={state} onChange={(e) => setState(e.target.value)} placeholder="State" className={inputClass} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="postal">Postal code</Label>
                <Input id="postal" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder="Postal code" className={inputClass} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="country">Country</Label>
              <Input id="country" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country" className={inputClass} />
            </div>
          </CardContent>
        </Card>

        {/* Business information */}
        <Card id="business" ref={(el) => { sectionRefs.current.business = el; }} className="border-gray-200 bg-white overflow-hidden scroll-mt-24">
          <CardHeader className="px-6 pt-6 pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Building2 className="h-5 w-5 text-gray-600" />
              Business information
            </CardTitle>
            <CardDescription className="mt-1">Optional. Business name and registration number if you invoice as a business.</CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-6 pt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="businessName">Business name</Label>
              <Input
                id="businessName"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Legal business name"
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="businessReg">Business registration number</Label>
              <Input
                id="businessReg"
                value={businessRegistrationNumber}
                onChange={(e) => setBusinessRegistrationNumber(e.target.value)}
                placeholder="VAT, EIN, company number, etc."
                className={inputClass}
              />
            </div>
          </CardContent>
        </Card>

        {/* Payout — same wallet used for deals and payroll */}
        <Card id="payout" ref={(el) => { sectionRefs.current.payout = el; }} className="border-gray-200 bg-white overflow-hidden scroll-mt-24">
          <CardHeader className="px-6 pt-6 pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Wallet className="h-5 w-5 text-gray-600" />
              Payout wallet
            </CardTitle>
            <CardDescription className="mt-1">
              Where you receive payments from this organization. Used for both deals and payroll. Set once and it stays the same.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-6 pt-4 space-y-4">
            <div className="space-y-1.5">
              <Label>Network & token</Label>
              <TokenCombobox
                tokens={tokens}
                value={network && tokenSymbol ? { symbol: tokenSymbol, chain: network } : undefined}
                onChange={(sel) => {
                  setNetwork(sel?.chain ?? null);
                  setTokenSymbol(sel?.symbol ?? null);
                }}
                placeholder="Select chain and token (e.g. Base + USDC)"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wallet">Wallet address</Label>
              <Input
                id="wallet"
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
                placeholder={network ? `Your ${network} address` : "Select network first"}
                className={inputClass}
                disabled={!network}
              />
              <p className="text-xs text-gray-500">
                Payments from deals and payroll for this org will be sent to this address.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* KYC */}
        <Card id="kyc" ref={(el) => { sectionRefs.current.kyc = el; }} className="border-gray-200 bg-white overflow-hidden scroll-mt-24">
          <CardHeader className="px-6 pt-6 pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShieldCheck className="h-5 w-5 text-gray-600" />
              KYC (identity verification)
            </CardTitle>
            <CardDescription className="mt-1">
              Verify your identity to meet compliance requirements. Required by some organizations before payout.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-6 pt-4 space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-4 min-h-[52px]">
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${isKycVerified ? "bg-green-100 text-green-600" : "bg-gray-200 text-gray-400"}`}>
                  <Check className="h-5 w-5" strokeWidth={2.5} />
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-900">
                    {isKycVerified ? "Verified" : "Unverified"}
                  </span>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {isKycVerified ? "Identity verified" : "Complete KYC to verify your identity"}
                  </p>
                </div>
              </div>
            </div>
            {!isKycVerified && (
              <Button type="button" variant="outline" className="w-full min-h-[44px] sm:min-h-[40px]" disabled>
                Complete KYC (coming soon)
              </Button>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <GradientActionButton type="submit" disabled={saving} loading={saving} loadingText="Saving..." className="min-h-[44px] sm:min-h-[40px] w-full sm:w-auto sm:min-w-[140px]">
            Save changes
          </GradientActionButton>
        </div>
      </form>
    </div>
  );
}
