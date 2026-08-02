"use client";

// Public SDK demo — configure a PayButton against the seeded "demo" organization, see it live,
// copy the integration snippet. Mirrors the old b2b/demo reference: config panel + live preview
// + code. Doesn't require login — anyone evaluating Loofta Pay should be able to reach this.

import { useState } from "react";
import { PayButton, generateEmbedCode, generateScriptEmbed } from "@/components/sdk/PayButton";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { Copy } from "lucide-react";

function CodeBlock({ code }: { code: string }) {
  const { toast } = useToast();
  return (
    <div className="relative">
      <pre className="text-sm bg-gray-950 border border-gray-800 rounded-lg p-4 overflow-x-auto text-gray-300 whitespace-pre-wrap break-all">
        {code}
      </pre>
      <button
        type="button"
        onClick={() => { navigator.clipboard.writeText(code); toast({ title: "Copied" }); }}
        className="absolute top-2 right-2 p-1.5 rounded bg-gray-900 border border-gray-800 text-gray-400 hover:text-gray-200"
        aria-label="Copy"
      >
        <Copy className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default function SdkDemoPage() {
  const [organizationId, setOrganizationId] = useState("demo");
  const [amount, setAmount] = useState("25");
  const [buttonText, setButtonText] = useState("Pay with Loofta");
  const [buttonBgColor, setButtonBgColor] = useState("");
  const [openMode, setOpenMode] = useState<"popup" | "redirect" | "tab">("popup");
  const [isPrivate, setIsPrivate] = useState(false);

  const props = {
    organizationId,
    amount: amount ? Number(amount) : undefined,
    buttonText: buttonText || undefined,
    buttonBgColor: buttonBgColor || undefined,
  };

  const restExample = `curl -X POST https://api.loofta.xyz/organizations/${organizationId || "your-org-id"}/checkout-sessions \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": ${amount || 25},
    "description": "Order #1234"${isPrivate ? ',\n    "isPrivate": true' : ""}
  }'`;

  return (
    <div className="min-h-screen max-w-5xl mx-auto px-4 py-10">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-gray-100">Loofta Pay — SDK demo</h1>
        <p className="text-base text-gray-500 mt-1">
          Configure a checkout button below, try it live against the demo organization (devnet), and copy the integration code.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        {/* Config panel */}
        <div className="space-y-4">
          <div>
            <label className="text-base text-gray-400 mb-1 block">Organization ID</label>
            <Input value={organizationId} onChange={(e) => setOrganizationId(e.target.value.trim())} />
          </div>
          <div>
            <label className="text-base text-gray-400 mb-1 block">Amount (USD)</label>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
          </div>
          <div>
            <label className="text-base text-gray-400 mb-1 block">Button text</label>
            <Input value={buttonText} onChange={(e) => setButtonText(e.target.value)} />
          </div>
          <div>
            <label className="text-base text-gray-400 mb-1 block">Button color (optional)</label>
            <Input value={buttonBgColor} onChange={(e) => setButtonBgColor(e.target.value)} placeholder="#1a1a1a or a gradient" />
          </div>
          <div>
            <label className="text-base text-gray-400 mb-1 block">Open mode</label>
            <div className="flex gap-1">
              {(["popup", "redirect", "tab"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setOpenMode(m)}
                  className={`px-2.5 py-1 text-sm rounded ${openMode === m ? "bg-gray-700 text-gray-100" : "bg-gray-900 text-gray-500 hover:text-gray-300"}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <label className="text-base text-gray-400">Private payment</label>
            <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
          </div>
        </div>

        {/* Live preview */}
        <div className="border border-gray-800 rounded-lg p-8 flex flex-col items-center justify-center gap-4 bg-gray-950/50">
          <p className="text-sm text-gray-500">Live preview</p>
          <PayButton {...props} openMode={openMode} />
          <p className="text-sm text-gray-600 text-center max-w-xs">
            Opens the real /checkout flow for the &ldquo;{organizationId || "…"}&rdquo; organization on devnet.
          </p>
        </div>
      </div>

      <div className="mt-10">
        <h2 className="text-base font-medium text-gray-200 mb-3">Integration code</h2>
        <Tabs defaultValue="react">
          <TabsList>
            <TabsTrigger value="react">React</TabsTrigger>
            <TabsTrigger value="html">HTML</TabsTrigger>
            <TabsTrigger value="rest">REST API</TabsTrigger>
          </TabsList>
          <TabsContent value="react">
            <CodeBlock code={generateEmbedCode(props)} />
          </TabsContent>
          <TabsContent value="html">
            <CodeBlock code={generateScriptEmbed(props)} />
          </TabsContent>
          <TabsContent value="rest">
            <CodeBlock code={restExample} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
