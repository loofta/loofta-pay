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
  address: '',
  token: 'USDC',
  network: 'base',
};

const DEMO_WALLET_STORAGE_KEY = 'loofta_demo_wallet';

export default function PayButtonDemoPage() {
  const { toast } = useToast();
  const { userId } = useAuth();
  const [copied, setCopied] = useState<string | null>(null);
  const { data: tokens = [] } = useTokensQuery();

  // Demo configuration
  const [config, setConfig] = useState(DEFAULT_CONFIG);

  // Demo wallet configuration (stored locally per user)
  const [demoWallet, setDemoWallet] = useState(DEFAULT_DEMO_WALLET);
  const [demoTokenSelection, setDemoTokenSelection] = useState<TokenSelection | null>({
    symbol: DEFAULT_DEMO_WALLET.token,
    chain: DEFAULT_DEMO_WALLET.network,
  });
  const [savingWallet, setSavingWallet] = useState(false);

  // Load demo wallet and logo from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(DEMO_WALLET_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          setDemoWallet(parsed);
          setDemoTokenSelection({
            symbol: parsed.token || DEFAULT_DEMO_WALLET.token,
            chain: parsed.network || DEFAULT_DEMO_WALLET.network,
          });
          // Load logo if available
          if (parsed.logoUrl) {
            setConfig(prev => ({ ...prev, logoUrl: parsed.logoUrl }));
          }
        }
      } catch (error) {
        console.error('Failed to load demo wallet from localStorage:', error);
      }
    }
  }, []);

  // Load demo organization when component mounts (just to verify it exists)
  useEffect(() => {
    if (config.organizationId === 'demo') {
      loadDemoOrganization();
    }
  }, [config.organizationId]);

  const loadDemoOrganization = async () => {
    try {
      const data = await organizationsApi.getByOrganizationId('demo');
      if (!data.organization) {
        console.warn('Demo organization not found in database');
      }
    } catch (error) {
      console.error('Failed to load demo organization:', error);
    }
  };

  const handleSaveDemoWallet = async () => {
    if (!demoWallet.address.trim()) {
      toast({
        variant: 'destructive',
        title: 'Wallet address required',
        description: 'Please enter a wallet address to receive demo payments',
      });
      return;
    }

    if (!demoTokenSelection) {
      toast({
        variant: 'destructive',
        title: 'Token selection required',
        description: 'Please select a token and network',
      });
      return;
    }

    setSavingWallet(true);
    try {
      // Save to localStorage (per-user, local storage)
      // Include logoUrl if it exists in config
      const walletData = {
        address: demoWallet.address.trim(),
        token: demoTokenSelection.symbol,
        network: demoTokenSelection.chain,
        ...(config.logoUrl ? { logoUrl: config.logoUrl } : {}),
      };

      if (typeof window !== 'undefined') {
        localStorage.setItem(DEMO_WALLET_STORAGE_KEY, JSON.stringify(walletData));
      }

      toast({
        title: 'Demo wallet saved',
        description: 'Your demo wallet settings have been saved locally',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Failed to save',
        description: error?.message || 'Could not save demo wallet',
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
    // Clear localStorage
    if (typeof window !== 'undefined') {
      localStorage.removeItem(DEMO_WALLET_STORAGE_KEY);
    }
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
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <Link href="/b2b" className="p-2 rounded-xl bg-gray-100 text-gray-600 hover:text-gray-900 hover:bg-gray-200 transition-all">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">PayButton Demo</h1>
              <p className="text-base text-gray-600">Test and configure your payment button</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-base bg-orange-100 text-orange-700 px-4 py-2 rounded-full font-semibold border border-orange-200">
              SDK v1.0
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-10">
        {/* Main Layout: Customizer Left, Preview + Code Right */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: Customizer - All Options */}
          <Card className="lg:col-span-1 border border-gray-200 shadow-lg bg-white rounded-2xl overflow-hidden">
            <CardHeader className="bg-white px-6 pt-6 pb-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-3 text-lg">
                    <div className="p-2 rounded-xl bg-gray-100">
                      <Sparkles className="w-5 h-5 text-orange-500" />
                    </div>
                    Customizer
                  </CardTitle>
                  <CardDescription className="text-base text-gray-600 mt-1">
                    Configure your button
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  className="flex items-center gap-2 rounded-xl border-gray-300 hover:bg-gray-100 text-gray-700"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              {/* Organization ID */}
              <div className="space-y-2">
                <Label htmlFor="orgId" className="text-base font-semibold text-gray-900">Organization ID *</Label>
                <Input
                  id="orgId"
                  value={config.organizationId}
                  onChange={(e) => setConfig({ ...config, organizationId: e.target.value })}
                  placeholder="your-org-id"
                  className="h-12 rounded-xl border-gray-300 focus:border-orange-400 focus:ring-orange-300 text-base"
                />
                <p className="text-sm text-gray-500">Use "demo" for testing</p>
              </div>

              {/* Amount */}
              <div className="space-y-2">
                <Label htmlFor="amount" className="text-base font-semibold text-gray-900">Amount</Label>
                <Input
                  id="amount"
                  type="number"
                  value={config.amount}
                  onChange={(e) => setConfig({ ...config, amount: e.target.value })}
                  placeholder="100"
                  className="h-12 rounded-xl border-gray-300 focus:border-orange-400 focus:ring-orange-300 text-base"
                />
              </div>

              {/* Button Text */}
              <div className="space-y-2">
                <Label htmlFor="buttonText" className="text-base font-semibold text-gray-900">Button Text</Label>
                <Input
                  id="buttonText"
                  value={config.buttonText}
                  onChange={(e) => setConfig({ ...config, buttonText: e.target.value })}
                  placeholder="Pay with Loofta"
                  className="h-12 rounded-xl border-gray-300 focus:border-orange-400 focus:ring-orange-300 text-base"
                />
              </div>

              {/* Logo Upload */}
              <div className="space-y-2">
                <Label htmlFor="logoUpload" className="text-base font-semibold text-gray-900">Logo</Label>
                <div className="space-y-3">
                  {config.logoUrl && (
                    <div className="relative w-24 h-24 border border-gray-300 rounded-lg overflow-hidden bg-white">
                      <img
                        src={config.logoUrl}
                        alt="Logo preview"
                        className="w-full h-full object-contain"
                      />
                    </div>
                  )}
                  <label className="cursor-pointer">
                    <div className="flex items-center gap-3 px-4 py-3 border-2 border-dashed border-gray-300 rounded-xl hover:border-orange-400 hover:bg-orange-50/50 transition-colors">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-600">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                      <span className="text-sm font-medium text-gray-700">
                        {config.logoUrl ? 'Change logo' : 'Upload logo'}
                      </span>
                    </div>
                    <input
                      id="logoUpload"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            const result = reader.result as string;
                            setConfig({ ...config, logoUrl: result });
                            // Store in localStorage for demo organization
                            if (typeof window !== 'undefined') {
                              try {
                                const stored = localStorage.getItem(DEMO_WALLET_STORAGE_KEY);
                                const demoWallet = stored ? JSON.parse(stored) : {};
                                localStorage.setItem(DEMO_WALLET_STORAGE_KEY, JSON.stringify({
                                  ...demoWallet,
                                  logoUrl: result,
                                }));
                              } catch (error) {
                                console.warn("Failed to save logo to localStorage:", error);
                              }
                            }
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                  </label>
                  {config.logoUrl && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setConfig({ ...config, logoUrl: '' });
                        // Remove from localStorage
                        if (typeof window !== 'undefined') {
                          try {
                            const stored = localStorage.getItem(DEMO_WALLET_STORAGE_KEY);
                            const demoWallet = stored ? JSON.parse(stored) : {};
                            delete demoWallet.logoUrl;
                            localStorage.setItem(DEMO_WALLET_STORAGE_KEY, JSON.stringify(demoWallet));
                          } catch (error) {
                            console.warn("Failed to remove logo from localStorage:", error);
                          }
                        }
                      }}
                      className="text-sm"
                    >
                      Remove logo
                    </Button>
                  )}
                </div>
                <p className="text-sm text-gray-500">Upload an image file (PNG, JPG, etc.)</p>
              </div>

              {/* Callback URL */}
              <div className="space-y-2">
                <Label htmlFor="callbackUrl" className="text-base font-semibold text-gray-900">Callback URL</Label>
                <Input
                  id="callbackUrl"
                  value={config.callbackUrl}
                  onChange={(e) => setConfig({ ...config, callbackUrl: e.target.value })}
                  placeholder="https://yoursite.com/success"
                  className="h-12 rounded-xl border-gray-300 focus:border-orange-400 focus:ring-orange-300 text-base"
                />
                <p className="text-sm text-gray-500">Redirect after payment</p>
              </div>

              {/* Color Settings */}
              <div className="space-y-4 p-4 bg-gray-50 rounded-xl border border-gray-200">
                <Label className="text-base font-semibold text-gray-900 flex items-center gap-2">
                  🎨 Colors
                </Label>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="buttonBgColor" className="text-base font-medium text-gray-700">Button Background</Label>
                    <div className="flex gap-2">
                      <Input
                        id="buttonBgColor"
                        value={config.buttonBgColor}
                        onChange={(e) => setConfig({ ...config, buttonBgColor: e.target.value })}
                        placeholder="#FF0F00"
                        className="h-11 rounded-xl border-gray-300 focus:border-orange-400 focus:ring-orange-300 text-base"
                      />
                      <input
                        type="color"
                        value={config.buttonBgColor || '#FF0F00'}
                        onChange={(e) => setConfig({ ...config, buttonBgColor: e.target.value })}
                        className="w-11 h-11 rounded-xl border-2 border-gray-300 cursor-pointer hover:border-orange-400 transition-colors flex-shrink-0"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="pageBgColor" className="text-base font-medium text-gray-700">Page Background</Label>
                    <div className="flex gap-2">
                      <Input
                        id="pageBgColor"
                        value={config.pageBgColor}
                        onChange={(e) => setConfig({ ...config, pageBgColor: e.target.value })}
                        placeholder="#FFFFFF"
                        className="h-11 rounded-xl border-gray-300 focus:border-orange-400 focus:ring-orange-300 text-base"
                      />
                      <input
                        type="color"
                        value={config.pageBgColor || '#FFFFFF'}
                        onChange={(e) => setConfig({ ...config, pageBgColor: e.target.value })}
                        className="w-11 h-11 rounded-xl border-2 border-gray-300 cursor-pointer hover:border-orange-400 transition-colors flex-shrink-0"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Demo Wallet Configuration */}
              {config.organizationId === 'demo' && (
                <div className="mt-4 p-4 bg-gray-50 border border-gray-300 rounded-xl">
                  <div className="flex items-start gap-3 mb-4">
                    <Wallet className="w-5 h-5 text-gray-700 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-base font-semibold text-gray-900 mb-1">Demo Wallet *</p>
                      <p className="text-sm text-gray-600">
                        Configure where demo payments will be sent (required)
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label className="text-base font-medium text-gray-700">
                        Token & Network *
                      </Label>
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

                    <div className="space-y-2">
                      <Label htmlFor="demoWalletAddress" className="text-base font-medium text-gray-700">
                        Wallet Address *
                      </Label>
                      <div className="flex items-center gap-2">
                        <Wallet className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        <Input
                          id="demoWalletAddress"
                          value={demoWallet.address}
                          onChange={(e) => setDemoWallet({ ...demoWallet, address: e.target.value })}
                          placeholder="Enter wallet address (e.g., 0x...)"
                          required
                          className={`h-11 rounded-xl border-gray-300 bg-white focus:border-blue-500 focus:ring-blue-400 font-mono text-base ${!demoWallet.address.trim() ? 'border-red-300' : ''
                            }`}
                        />
                      </div>
                      {!demoWallet.address.trim() && (
                        <p className="text-sm text-red-600">
                          Wallet address is required to receive payments
                        </p>
                      )}
                    </div>

                    <Button
                      onClick={handleSaveDemoWallet}
                      disabled={savingWallet || !demoWallet.address.trim() || !demoTokenSelection}
                      className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-base disabled:bg-gray-300 disabled:text-gray-500"
                    >
                      {savingWallet ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4 mr-2" />
                          Save Demo Wallet
                        </>
                      )}
                    </Button>

                    <p className="text-sm text-gray-500 text-center">
                      Saved locally in your browser
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Right: Preview + Code */}
          <div className="lg:col-span-2 space-y-6">
            {/* Preview Section */}
            <Card className="border border-gray-200 shadow-lg bg-white rounded-2xl overflow-hidden">
              <CardHeader className="bg-white px-6 pt-6 pb-4 border-b border-gray-200">
                <CardTitle className="flex items-center gap-3 text-lg">
                  <div className="p-2 rounded-xl bg-gray-100">
                    <Eye className="w-5 h-5 text-orange-500" />
                  </div>
                  Preview
                </CardTitle>
                <CardDescription className="text-base text-gray-600">
                  Click to test checkout
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <div
                  className="rounded-xl border-2 border-dashed border-gray-300 p-10 flex flex-col items-center justify-center min-h-[320px] transition-colors"
                  style={{ backgroundColor: config.pageBgColor || '#FFFFFF' }}
                >
                  <div className="text-center mb-8">
                    <div className="inline-block px-4 py-1.5 rounded-full bg-white/90 text-base text-gray-600 mb-4 shadow-sm border border-gray-200">Your website</div>
                    <div className="text-4xl font-bold text-gray-900">
                      {config.amount ? `$${config.amount}` : 'Custom'}
                    </div>
                    <div className="text-gray-600 text-base mt-2">Total to pay</div>
                  </div>

                  <PayButton
                    organizationId={config.organizationId}
                    amount={config.amount ? Number(config.amount) : undefined}
                    buttonBgColor={config.buttonBgColor || undefined}
                    pageBgColor={config.pageBgColor || undefined}
                    callbackUrl={config.callbackUrl || undefined}
                    buttonText={config.buttonText}
                    onSuccess={handlePaymentSuccess}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Code Section */}
            <Card className="border border-gray-200 shadow-lg bg-white rounded-2xl overflow-hidden">
              <CardHeader className="bg-white px-6 pt-6 pb-4 border-b border-gray-200">
                <CardTitle className="flex items-center gap-3 text-lg">
                  <div className="p-2 rounded-xl bg-gray-100">
                    <Code className="w-5 h-5 text-orange-500" />
                  </div>
                  Integration Code
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <Tabs defaultValue="react">
                  <TabsList className="mb-4 bg-gray-100 p-1 rounded-xl">
                    <TabsTrigger value="react" className="rounded-lg px-4 text-base data-[state=active]:bg-white data-[state=active]:shadow-sm">React / Next.js</TabsTrigger>
                    <TabsTrigger value="html" className="rounded-lg px-4 text-base data-[state=active]:bg-white data-[state=active]:shadow-sm">HTML / Script</TabsTrigger>
                    <TabsTrigger value="api" className="rounded-lg px-4 text-base data-[state=active]:bg-white data-[state=active]:shadow-sm flex items-center gap-2">
                      REST API
                      <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-semibold">Soon</span>
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="react">
                    <div className="relative">
                      <pre className="bg-gray-900 text-gray-100 rounded-xl p-5 text-base overflow-x-auto shadow-inner max-h-[250px]">
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
                    <p className="text-base text-gray-600 mt-4">
                      Install: <code className="bg-gray-100 px-2 py-1 rounded-lg font-mono text-base">npm install @loofta/pay-sdk</code>
                    </p>
                  </TabsContent>

                  <TabsContent value="html">
                    <div className="relative">
                      <pre className="bg-gray-900 text-gray-100 rounded-xl p-5 text-base overflow-x-auto shadow-inner max-h-[250px]">
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
                    <div className="rounded-xl bg-orange-50 border border-orange-200 p-8 text-center">
                      <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-white shadow-md mb-4">
                        <Code className="w-8 h-8 text-orange-500" />
                      </div>
                      <h3 className="text-xl font-bold text-gray-900 mb-2">REST API Coming Soon</h3>
                      <p className="text-base text-gray-600 mb-4 max-w-md mx-auto">
                        Server-side integration for creating payment intents, managing webhooks, and more.
                      </p>
                      <pre className="bg-gray-900/90 text-gray-300 rounded-xl p-4 text-base text-left max-w-lg mx-auto overflow-x-auto opacity-60">
                        <code>{`// Preview - Coming Soon
POST /api/v1/payments/create
{
  "organizationId": "${config.organizationId}",
  "amount": ${config.amount || '100'},
  "currency": "USD"
}

// Response → { paymentId, checkoutUrl }`}</code>
                      </pre>
                      <p className="text-base text-gray-600 mt-4">
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
          </div>
        </div>
      </div>
    </div>
  );
}
