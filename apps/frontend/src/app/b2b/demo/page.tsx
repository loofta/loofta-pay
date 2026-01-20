'use client';

import { useState, useEffect } from 'react';
import { PayButton, generateEmbedCode, generateScriptEmbed } from '@/components/sdk/PayButton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { Copy, Check, Code, Eye, Sparkles, ArrowLeft, RotateCcw, AlertTriangle, Wallet, Save, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { TokenCombobox } from '@/components/TokenCombobox';
import { useTokensQuery } from '@/hooks/useTokensQuery';
import type { TokenSelection } from '@/app/utils/types';
import { organizationsApi } from '@/services/api/organizations';
import { useAuth } from '@/hooks/useAuth';

const DEFAULT_CONFIG = {
  organizationId: 'demo',
  amount: '100',
  buttonBgColor: '',
  pageBgColor: '',
  logoUrl: '',
  callbackUrl: '',
  buttonText: 'Pay with Loofta',
};

const DEFAULT_DEMO_WALLET = {
  address: '0xd28d8e18537a6De75900D2eafE8E718aA4A2Df11',
  token: 'USDC',
  network: 'base',
};

export default function PayButtonDemoPage() {
  const { toast } = useToast();
  const { userId } = useAuth();
  const [copied, setCopied] = useState<string | null>(null);
  const { data: tokens = [] } = useTokensQuery();

  // Demo configuration
  const [config, setConfig] = useState(DEFAULT_CONFIG);

  // Demo wallet configuration
  const [demoWallet, setDemoWallet] = useState(DEFAULT_DEMO_WALLET);
  const [demoTokenSelection, setDemoTokenSelection] = useState<TokenSelection | null>({
    symbol: DEFAULT_DEMO_WALLET.token,
    chain: DEFAULT_DEMO_WALLET.network,
  });
  const [demoOrgId, setDemoOrgId] = useState<string | null>(null);
  const [savingWallet, setSavingWallet] = useState(false);

  // Load demo organization when component mounts
  useEffect(() => {
    if (config.organizationId === 'demo') {
      loadDemoOrganization();
    }
  }, [config.organizationId]);

  const loadDemoOrganization = async () => {
    try {
      const data = await organizationsApi.getByOrganizationId('demo');
      if (data.organization) {
        setDemoOrgId(data.organization.id);
        if (data.organization.recipient_wallet) {
          setDemoWallet({
            address: data.organization.recipient_wallet,
            token: data.organization.token_symbol || DEFAULT_DEMO_WALLET.token,
            network: data.organization.token_chain || DEFAULT_DEMO_WALLET.network,
          });
          setDemoTokenSelection({
            symbol: data.organization.token_symbol || DEFAULT_DEMO_WALLET.token,
            chain: data.organization.token_chain || DEFAULT_DEMO_WALLET.network,
          });
        }
      }
    } catch (error) {
      console.error('Failed to load demo organization:', error);
    }
  };

  const handleSaveDemoWallet = async () => {
    if (!demoOrgId || !userId) {
      toast({
        variant: 'destructive',
        title: 'Cannot save',
        description: 'Admin access required to update demo organization',
      });
      return;
    }

    setSavingWallet(true);
    try {
      await organizationsApi.update(
        {
          id: demoOrgId,
          recipient_wallet: demoWallet.address,
          token_symbol: demoWallet.token,
          token_chain: demoWallet.network,
        },
        userId
      );
      toast({
        title: 'Demo wallet updated',
        description: 'Changes have been saved successfully',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Failed to save',
        description: error?.message || 'Could not update demo wallet',
      });
    } finally {
      setSavingWallet(false);
    }
  };

  const handleReset = () => {
    setConfig(DEFAULT_CONFIG);
    setDemoWallet(DEFAULT_DEMO_WALLET);
    setDemoTokenSelection({
      symbol: DEFAULT_DEMO_WALLET.token,
      chain: DEFAULT_DEMO_WALLET.network,
    });
    toast({ title: 'Settings reset', description: 'All fields have been reset to defaults' });
  };

  const handleCopy = async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      toast({ title: 'Copied!', description: 'Code copied to clipboard' });
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast({ variant: 'destructive', title: 'Failed to copy' });
    }
  };

  const handlePaymentSuccess = (paymentId: string) => {
    toast({
      title: '🎉 Payment Successful!',
      description: `Payment ID: ${paymentId}`,
    });
  };

  const reactCode = generateEmbedCode({
    organizationId: config.organizationId,
    amount: config.amount ? Number(config.amount) : undefined,
    buttonBgColor: config.buttonBgColor || undefined,
    pageBgColor: config.pageBgColor || undefined,
    logoUrl: config.logoUrl || undefined,
    callbackUrl: config.callbackUrl || undefined,
    buttonText: config.buttonText || undefined,
  });

  const scriptCode = generateScriptEmbed({
    organizationId: config.organizationId,
    amount: config.amount ? Number(config.amount) : undefined,
    buttonBgColor: config.buttonBgColor || undefined,
    pageBgColor: config.pageBgColor || undefined,
    callbackUrl: config.callbackUrl || undefined,
    buttonText: config.buttonText || undefined,
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50/50 via-white to-red-50/30">
      {/* Header */}
      <div className="border-b border-gray-100 bg-white/90 backdrop-blur-md sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <Link href="/b2b" className="p-2 rounded-xl bg-gray-100 text-gray-600 hover:text-gray-900 hover:bg-gray-200 transition-all">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">PayButton Demo</h1>
              <p className="text-sm text-gray-500">Test and configure your payment button</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm bg-gradient-to-r from-orange-100 to-red-100 text-orange-700 px-4 py-2 rounded-full font-semibold border border-orange-200">
              SDK v1.0
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-10 space-y-8">
        {/* Row 1: Configuration + Live Preview */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Configuration - Takes 3 columns */}
          <Card className="lg:col-span-3 border-0 shadow-xl shadow-gray-200/50 bg-white rounded-3xl overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-orange-50 to-red-50 px-8 pt-8 pb-6 border-b border-orange-100">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-3 text-xl">
                    <div className="p-2 rounded-xl bg-white shadow-sm">
                      <Sparkles className="w-5 h-5 text-orange-500" />
                    </div>
                    Configure Button
                  </CardTitle>
                  <CardDescription className="text-gray-600 mt-1">
                    Customize your PayButton settings
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  className="flex items-center gap-2 rounded-xl border-orange-200 hover:bg-orange-100 text-orange-700"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Left Column - Basic Settings */}
                <div className="space-y-5">
                  <div className="space-y-3">
                    <Label htmlFor="orgId" className="text-sm font-semibold text-gray-700">Organization ID *</Label>
                    <Input
                      id="orgId"
                      value={config.organizationId}
                      onChange={(e) => setConfig({ ...config, organizationId: e.target.value })}
                      placeholder="your-org-id"
                      className="h-11 rounded-xl border-gray-200 focus:border-orange-300 focus:ring-orange-200"
                    />
                    <p className="text-sm text-gray-400">Use "demo" for testing</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <Label htmlFor="amount" className="text-sm font-semibold text-gray-700">Amount</Label>
                      <Input
                        id="amount"
                        type="number"
                        value={config.amount}
                        onChange={(e) => setConfig({ ...config, amount: e.target.value })}
                        placeholder="100"
                        className="h-11 rounded-xl border-gray-200 focus:border-orange-300 focus:ring-orange-200"
                      />
                    </div>
                    <div className="space-y-3">
                      <Label htmlFor="buttonText" className="text-sm font-semibold text-gray-700">Button Text</Label>
                      <Input
                        id="buttonText"
                        value={config.buttonText}
                        onChange={(e) => setConfig({ ...config, buttonText: e.target.value })}
                        placeholder="Pay with Loofta"
                        className="h-11 rounded-xl border-gray-200 focus:border-orange-300 focus:ring-orange-200"
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Label htmlFor="logoUrl" className="text-sm font-semibold text-gray-700">Logo URL</Label>
                    <Input
                      id="logoUrl"
                      value={config.logoUrl}
                      onChange={(e) => setConfig({ ...config, logoUrl: e.target.value })}
                      placeholder="https://..."
                      className="h-11 rounded-xl border-gray-200 focus:border-orange-300 focus:ring-orange-200"
                    />
                  </div>

                  <div className="space-y-3">
                    <Label htmlFor="callbackUrl" className="text-sm font-semibold text-gray-700">Callback URL</Label>
                    <Input
                      id="callbackUrl"
                      value={config.callbackUrl}
                      onChange={(e) => setConfig({ ...config, callbackUrl: e.target.value })}
                      placeholder="https://yoursite.com/success"
                      className="h-11 rounded-xl border-gray-200 focus:border-orange-300 focus:ring-orange-200"
                    />
                    <p className="text-sm text-gray-400">Redirect after payment</p>
                  </div>
                </div>

                {/* Right Column - Colors */}
                <div className="space-y-5">
                  <div className="space-y-4 p-5 bg-gradient-to-br from-gray-50 to-orange-50/30 rounded-2xl border border-gray-100">
                    <Label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                      🎨 Color Settings
                    </Label>

                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="buttonBgColor" className="text-sm font-medium text-gray-600">Button Background</Label>
                        <div className="flex gap-2">
                          <Input
                            id="buttonBgColor"
                            value={config.buttonBgColor}
                            onChange={(e) => setConfig({ ...config, buttonBgColor: e.target.value })}
                            placeholder="#FF0F00"
                            className="h-10 rounded-xl border-gray-200 focus:border-orange-300 focus:ring-orange-200 text-sm"
                          />
                          <input
                            type="color"
                            value={config.buttonBgColor || '#FF0F00'}
                            onChange={(e) => setConfig({ ...config, buttonBgColor: e.target.value })}
                            className="w-10 h-10 rounded-xl border-2 border-gray-200 cursor-pointer hover:border-orange-300 transition-colors flex-shrink-0"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="pageBgColor" className="text-sm font-medium text-gray-600">Checkout Page Background</Label>
                        <div className="flex gap-2">
                          <Input
                            id="pageBgColor"
                            value={config.pageBgColor}
                            onChange={(e) => setConfig({ ...config, pageBgColor: e.target.value })}
                            placeholder="#FFFFFF"
                            className="h-10 rounded-xl border-gray-200 focus:border-orange-300 focus:ring-orange-200 text-sm"
                          />
                          <input
                            type="color"
                            value={config.pageBgColor || '#FFFFFF'}
                            onChange={(e) => setConfig({ ...config, pageBgColor: e.target.value })}
                            className="w-10 h-10 rounded-xl border-2 border-gray-200 cursor-pointer hover:border-orange-300 transition-colors flex-shrink-0"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Color Preview */}
                    <div className="mt-4 pt-4 border-t border-gray-200/50">
                      <p className="text-sm text-gray-500 mb-2">Preview</p>
                      <div
                        className="h-16 rounded-xl flex items-center justify-center transition-colors"
                        style={{ backgroundColor: config.pageBgColor || '#FFFFFF' }}
                      >
                        <div
                          className="px-4 py-2 rounded-lg text-white text-sm font-medium shadow-md"
                          style={{ background: config.buttonBgColor || 'linear-gradient(to right, #FF0F00, #EAB308)' }}
                        >
                          {config.buttonText || 'Pay with Loofta'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Live Preview - Takes 2 columns */}
          <Card className="lg:col-span-2 border-0 shadow-xl shadow-orange-100/50 bg-white rounded-3xl overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-orange-50 to-amber-50 px-6 pt-6 pb-4 border-b border-orange-100">
              <CardTitle className="flex items-center gap-3 text-lg">
                <div className="p-2 rounded-xl bg-white shadow-sm">
                  <Eye className="w-4 h-4 text-orange-500" />
                </div>
                Live Preview
              </CardTitle>
              <CardDescription className="text-gray-600 text-sm">
                Click to test checkout
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <div
                className="rounded-2xl border-2 border-dashed border-gray-200 p-8 flex flex-col items-center justify-center min-h-[280px] transition-colors"
                style={{ backgroundColor: config.pageBgColor || '#FFFFFF' }}
              >
                <div className="text-center mb-8">
                  <div className="inline-block px-3 py-1 rounded-full bg-white/80 text-sm text-gray-500 mb-3 shadow-sm">Your website</div>
                  <div className="text-3xl font-bold text-gray-900">
                    {config.amount ? `$${config.amount}` : 'Custom'}
                  </div>
                  <div className="text-gray-500 text-sm mt-1">Total to pay</div>
                </div>

                <PayButton
                  organizationId={config.organizationId}
                  amount={config.amount ? Number(config.amount) : undefined}
                  buttonBgColor={config.buttonBgColor || undefined}
                  pageBgColor={config.pageBgColor || undefined}
                  logoUrl={config.logoUrl || undefined}
                  callbackUrl={config.callbackUrl || undefined}
                  buttonText={config.buttonText}
                  onSuccess={handlePaymentSuccess}
                />

                <p className="text-sm text-gray-400 mt-6">
                  Powered by Loofta Pay
                </p>
              </div>

              {/* Demo Wallet Configuration */}
              {config.organizationId === 'demo' && (
                <div className="mt-4 p-5 bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-xl">
                  <div className="flex items-start gap-3 mb-4">
                    <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-amber-900 mb-1">Demo Wallet Configuration</p>
                      <p className="text-xs text-amber-700">
                        Configure where demo payments will be sent. This is for testing purposes only.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {/* Token & Network Selection */}
                    <div className="space-y-2">
                      <Label className="text-xs font-medium text-amber-800">Payment Token & Network</Label>
                      <TokenCombobox
                        tokens={tokens}
                        value={demoTokenSelection || undefined}
                        onChange={(selection) => {
                          setDemoTokenSelection(selection);
                          if (selection) {
                            setDemoWallet({
                              ...demoWallet,
                              token: selection.symbol,
                              network: selection.chain,
                            });
                          }
                        }}
                        placeholder="Select token and network..."
                      />
                    </div>

                    {/* Wallet Address */}
                    <div className="space-y-2">
                      <Label htmlFor="demoWalletAddress" className="text-xs font-medium text-amber-800">
                        Recipient Wallet Address
                      </Label>
                      <div className="flex items-center gap-2">
                        <Wallet className="w-4 h-4 text-amber-600 flex-shrink-0" />
                        <Input
                          id="demoWalletAddress"
                          value={demoWallet.address}
                          onChange={(e) => setDemoWallet({ ...demoWallet, address: e.target.value })}
                          placeholder="0x..."
                          className="h-10 rounded-xl border-amber-200 bg-white focus:border-amber-400 focus:ring-amber-300 font-mono text-sm"
                        />
                      </div>
                    </div>

                    {/* Save Button */}
                    <Button
                      onClick={handleSaveDemoWallet}
                      disabled={savingWallet || !userId}
                      className="w-full h-10 bg-amber-600 hover:bg-amber-700 text-white rounded-xl"
                    >
                      {savingWallet ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4 mr-2" />
                          Save Demo Wallet Settings
                        </>
                      )}
                    </Button>

                    {!userId && (
                      <p className="text-xs text-amber-600 text-center">
                        Admin login required to save changes
                      </p>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Row 2: Integration Code (full width) */}
        <Card className="border-0 shadow-xl shadow-gray-200/50 bg-white rounded-3xl overflow-hidden">
          <CardHeader className="bg-gradient-to-r from-gray-50 to-slate-50 px-8 pt-6 pb-4 border-b border-gray-100">
            <CardTitle className="flex items-center gap-3 text-lg">
              <div className="p-2 rounded-xl bg-white shadow-sm">
                <Code className="w-4 h-4 text-orange-500" />
              </div>
              Integration Code
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <Tabs defaultValue="react">
              <TabsList className="mb-4 bg-gray-100 p-1 rounded-xl">
                <TabsTrigger value="react" className="rounded-lg px-4 data-[state=active]:bg-white data-[state=active]:shadow-sm">React / Next.js</TabsTrigger>
                <TabsTrigger value="html" className="rounded-lg px-4 data-[state=active]:bg-white data-[state=active]:shadow-sm">HTML / Script</TabsTrigger>
                <TabsTrigger value="api" className="rounded-lg px-4 data-[state=active]:bg-white data-[state=active]:shadow-sm flex items-center gap-2">
                  REST API
                  <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full font-semibold">Soon</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="react">
                <div className="relative">
                  <pre className="bg-gray-900 text-gray-100 rounded-2xl p-5 text-sm overflow-x-auto shadow-inner max-h-[200px]">
                    <code>{reactCode}</code>
                  </pre>
                  <Button
                    size="sm"
                    variant="outline"
                    className="absolute top-3 right-3 bg-white/10 border-white/20 text-white hover:bg-white/20"
                    onClick={() => handleCopy(reactCode, 'react')}
                  >
                    {copied === 'react' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
                <p className="text-sm text-gray-500 mt-3">
                  Install: <code className="bg-gray-100 px-2 py-1 rounded-lg font-mono text-sm">npm install @loofta/pay-sdk</code>
                </p>
              </TabsContent>

              <TabsContent value="html">
                <div className="relative">
                  <pre className="bg-gray-900 text-gray-100 rounded-2xl p-5 text-sm overflow-x-auto shadow-inner max-h-[200px]">
                    <code>{scriptCode}</code>
                  </pre>
                  <Button
                    size="sm"
                    variant="outline"
                    className="absolute top-3 right-3 bg-white/10 border-white/20 text-white hover:bg-white/20"
                    onClick={() => handleCopy(scriptCode, 'html')}
                  >
                    {copied === 'html' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="api">
                <div className="rounded-2xl bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200 p-8 text-center">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white shadow-md mb-4">
                    <Code className="w-8 h-8 text-orange-500" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">REST API Coming Soon</h3>
                  <p className="text-gray-600 mb-4 max-w-md mx-auto">
                    Server-side integration for creating payment intents, managing webhooks, and more.
                  </p>
                  <pre className="bg-gray-900/90 text-gray-300 rounded-xl p-4 text-sm text-left max-w-lg mx-auto overflow-x-auto opacity-60">
                    <code>{`// Preview - Coming Soon
POST /api/v1/payments/create
{
  "organizationId": "${config.organizationId}",
  "amount": ${config.amount || '100'},
  "currency": "USD"
}

// Response → { paymentId, checkoutUrl }`}</code>
                  </pre>
                  <p className="text-sm text-gray-500 mt-4">
                    Want early access?{' '}
                    <a href="mailto:hello@loofta.com" className="text-orange-600 hover:text-orange-700 font-medium">
                      Contact us →
                    </a>
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Row 3: How it works (full width) */}
        <Card className="border-0 shadow-xl shadow-gray-200/50 bg-white rounded-3xl overflow-hidden">
          <CardHeader className="px-6 pt-6 pb-4 border-b border-gray-100">
            <CardTitle className="text-lg">How it works</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {[
                { num: 1, title: 'Popup opens', desc: 'branded checkout' },
                { num: 2, title: 'Customer selects', desc: 'token & chain' },
                { num: 3, title: 'Address generated', desc: 'for the swap' },
                { num: 4, title: 'Customer deposits', desc: 'from any wallet' },
                { num: 5, title: 'You receive', desc: 'configured token' },
                { num: 6, title: 'Callback fired', desc: 'with confirmation' },
              ].map((step) => (
                <div key={step.num} className="flex flex-col items-center text-center p-4 rounded-xl bg-gray-50 hover:bg-orange-50 transition-colors">
                  <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-100 to-red-100 text-orange-600 flex items-center justify-center text-sm font-bold mb-3">
                    {step.num}
                  </span>
                  <p className="text-sm font-semibold text-gray-900">{step.title}</p>
                  <p className="text-sm text-gray-500 mt-0.5">{step.desc}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
