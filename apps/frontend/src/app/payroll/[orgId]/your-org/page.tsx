"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { payrollApi, type PayrollOrganization } from "@/services/api/payroll";
import { Loader2, ArrowLeft, Building2, MapPin } from "lucide-react";
import { GradientActionButton } from "@/components/ui/GradientActionButton";

const inputClass = "mt-1.5 min-h-[44px] sm:min-h-[40px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

export default function YourOrgPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const router = useRouter();
  const { authenticated, userId, ready } = useAuth();
  const { toast } = useToast();
  const [organization, setOrganization] = useState<PayrollOrganization | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [orgRole, setOrgRole] = useState<string | null>(null);

  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("");
  const [companyLegalName, setCompanyLegalName] = useState("");
  const [companyRegistrationNumber, setCompanyRegistrationNumber] = useState("");

  const loadOrg = useCallback(async () => {
    if (!orgId || !userId) return;
    try {
      setLoading(true);
      const [org, role] = await Promise.all([
        payrollApi.organizations.get(orgId, userId),
        payrollApi.organizations.getMyRole(orgId, userId).then((r) => r.role),
      ]);
      setOrganization(org);
      setOrgRole(role);
      setAddressLine1(org.address_line1 ?? "");
      setAddressLine2(org.address_line2 ?? "");
      setCity(org.city ?? "");
      setState(org.state ?? "");
      setPostalCode(org.postal_code ?? "");
      setCountry(org.country ?? "");
      setCompanyLegalName(org.company_legal_name ?? "");
      setCompanyRegistrationNumber(org.company_registration_number ?? "");
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not load organization." });
    } finally {
      setLoading(false);
    }
  }, [orgId, userId, toast]);

  useEffect(() => {
    if (ready && authenticated && orgId && userId) loadOrg();
  }, [ready, authenticated, orgId, userId, loadOrg]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !orgId) return;
    if (orgRole === "contributor") {
      toast({ variant: "destructive", title: "Access denied", description: "Only owners and admins can edit organization details." });
      return;
    }
    setSaving(true);
    try {
      const updated = await payrollApi.organizations.update(orgId, {
        address_line1: addressLine1.trim() || undefined,
        address_line2: addressLine2.trim() || undefined,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        postal_code: postalCode.trim() || undefined,
        country: country.trim() || undefined,
        company_legal_name: companyLegalName.trim() || undefined,
        company_registration_number: companyRegistrationNumber.trim() || undefined,
      }, userId);
      setOrganization(updated);
      toast({ title: "Saved", description: "Organization address and company info updated." });
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

  if (loading && !organization) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/payroll/${orgId}`}><ArrowLeft className="h-4 w-4 mr-2" /> Back</Link>
        </Button>
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-8 text-center text-amber-800">
            Organization not found or you don’t have access.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (orgRole === "contributor") {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/payroll/${orgId}`}><ArrowLeft className="h-4 w-4 mr-2" /> Back</Link>
        </Button>
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-8 text-center text-amber-800">
            Only organization owners and admins can edit address and company info.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="shrink-0" asChild>
          <Link href={`/payroll/${orgId}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-gray-900">Organization details</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Address and company info for {organization.name}. Used on invoices and contracts.
          </p>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <Card className="border-gray-200 bg-white overflow-hidden">
          <CardHeader className="px-6 pt-6 pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <MapPin className="h-5 w-5 text-gray-600" />
              Address
            </CardTitle>
            <CardDescription className="mt-1">Your organization’s address (for invoices and legal).</CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-6 pt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="org-address1">Address line 1</Label>
              <Input id="org-address1" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} placeholder="Street, number" className={inputClass} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-address2">Address line 2</Label>
              <Input id="org-address2" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} placeholder="Apt, suite, etc." className={inputClass} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="org-city">City</Label>
                <Input id="org-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" className={inputClass} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="org-state">State / Region</Label>
                <Input id="org-state" value={state} onChange={(e) => setState(e.target.value)} placeholder="State" className={inputClass} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="org-postal">Postal code</Label>
                <Input id="org-postal" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder="Postal code" className={inputClass} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-country">Country</Label>
              <Input id="org-country" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country" className={inputClass} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-200 bg-white overflow-hidden">
          <CardHeader className="px-6 pt-6 pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Building2 className="h-5 w-5 text-gray-600" />
              Company info
            </CardTitle>
            <CardDescription className="mt-1">Legal name and registration number (for invoices).</CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-6 pt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="org-legal">Legal company name</Label>
              <Input id="org-legal" value={companyLegalName} onChange={(e) => setCompanyLegalName(e.target.value)} placeholder="Registered company name" className={inputClass} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-reg">Company registration number</Label>
              <Input id="org-reg" value={companyRegistrationNumber} onChange={(e) => setCompanyRegistrationNumber(e.target.value)} placeholder="VAT, EIN, company number, etc." className={inputClass} />
            </div>
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
