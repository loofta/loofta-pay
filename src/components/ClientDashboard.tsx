import { useEffect, useState } from "react";
import { ArrowRight, Users, MessageSquare, Rocket, Star, TrendingUp, Target, CheckCircle } from "lucide-react";
import { CREATORS_ROUTE } from "@/app/utils/routes";
import { useRouter } from "next/navigation";
import DashboardLayout from './layouts/DashboardLayout';
import Image from "next/image";
import { Button } from "@/components/ui/button";

export default function ClientDashboard() {
  const [navigatingItem, setNavigatingItem] = useState<string | null>(null);
  const router = useRouter();
  const [showBoostInfo, setShowBoostInfo] = useState<boolean>(false);
  const [showKolInfo, setShowKolInfo] = useState<boolean>(false);
  const [showAmbInfo, setShowAmbInfo] = useState<boolean>(false);
  const budgetStops = [20, 50, 100, 200, 300, 500, 1000];
  const [budgetIndex, setBudgetIndex] = useState<number>(0);
  const budget = budgetStops[budgetIndex];
  const [postUrl, setPostUrl] = useState<string>("");

  const handleNavigation = (path: string, itemId: string) => {
    setNavigatingItem(itemId);
    router.push(path);
  };

  const DashboardContent = () => (
    <div className="flex-1 flex flex-col bg-gray-50 h-full">
      {/* Header removed per request */}

      {/* Main content - Full height, no scroll */}
      <div className="flex-1 flex items-start md:items-center justify-center">
        <div className="max-w-6xl mx-auto p-4 md:p-6 w-full">

          {/* Services */}
          <div className="space-y-8 md:space-y-10">

            {/* Row: Boost, Campaigns, Spotlight */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
              {/* Boost Post (compact) */}
              <div className="group cursor-default">
                <div className={`bg-white h-full rounded-3xl p-6 shadow-md transition-all duration-200 hover:-translate-y-2 hover:shadow-lg`}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-lg text-black flex items-center gap-2"><Rocket className="h-5 w-5 text-black" />Boost Post</h3>
                    <button type="button" onClick={() => setShowBoostInfo(true)} className="text-gray-500 hover:text-gray-800 text-sm">Info</button>
                  </div>
                  <p className="text-gray-600 text-sm mb-3">Run a fast engagement push with verified creators.</p>

                  {/* URL Input */}
                  <label className="block text-xs font-medium text-gray-700 mb-1">Input X Post URL</label>
                  <input
                    type="url"
                    value={postUrl}
                    onChange={(e) => setPostUrl(e.target.value)}
                    placeholder="https://x.com/yourURLtoQuote"
                    className="w-full rounded-lg border border-gray-200 bg-black/5 text-gray-900 placeholder-gray-500 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-400"
                    inputMode="url"
                  />

                  {/* Budget Slider */}
                  <div className="mt-4">
                    <div className="text-xs font-semibold text-gray-900 mb-2">Budget</div>
                    <input
                      type="range"
                      min={0}
                      max={budgetStops.length - 1}
                      step={1}
                      value={budgetIndex}
                      onChange={(e) => setBudgetIndex(Number(e.target.value))}
                      aria-label="Budget"
                      className="w-full boost-range"
                      style={{ ['--fill' as any]: `${(budgetIndex / (budgetStops.length - 1)) * 100}%` } as React.CSSProperties}
                    />
                    <div className="flex justify-between text-[10px] text-gray-700 mt-1">
                      {budgetStops.map((v, i) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setBudgetIndex(i)}
                          className={`px-1 -mx-1 transition-colors ${i === budgetIndex ? 'font-bold' : 'opacity-80'}`}
                          style={i === budgetIndex ? { background: 'linear-gradient(to right, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' } : {}}
                          aria-label={`Select budget $${v}`}
                        >
                          ${v}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Launch */}
                  <div className="mt-4 flex items-center justify-between">
                    <div className="text-[11px] text-gray-600">Selected: ${budget.toLocaleString()}</div>
                    <Button
                      style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}
                      className="px-4 py-2 text-white font-semibold rounded-lg border-0 shadow-sm"
                      onClick={() => handleNavigation('/boost', 'boost')}
                    >
                      Launch Boost
                    </Button>
                  </div>
                </div>
              </div>

              {/* Campaigns Card */}
              <div className="group cursor-pointer" onClick={() => handleNavigation('/advertise', 'campaigns')}>
                <div className={`bg-white h-full rounded-3xl p-6 shadow-md transition-all duration-200 ${navigatingItem === 'campaigns' ? 'opacity-75' : 'hover:-translate-y-2 hover:shadow-lg'}`}>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="bg-gradient-to-br from-[#FF0F00] to-yellow-500 p-3 rounded-xl"></div>
                  </div>
                  <h3 className="font-semibold text-lg mb-2 text-gray-900">Create a Campaign</h3>
                  <p className="text-gray-600 text-sm mb-3">Ask creators to complete tasks (on‑chain & off‑chain), compete in content contests, or trading competitions.</p>
                  <ul className="space-y-2 text-sm text-gray-700 boost-bullets">
                    <li>On‑chain: mints, swaps, staking</li>
                    <li>Off‑chain: follows, RT/quotes, joins</li>
                    <li>Giveaways, contests, trading comps</li>
                  </ul>
                </div>
              </div>

              {/* Loofta Spotlight - Twitter Space */}
              <div className="group cursor-pointer" onClick={() => window.open('https://t.me/looftaxyz', '_blank')}>
                <div className="bg-white h-full rounded-3xl p-6 shadow-md transition-all duration-200 hover:-translate-y-2 hover:shadow-lg">
                  <div className="mb-3 rounded-xl overflow-hidden">
                    <Image src="/images/looftaspotlight.jpg" alt="Loofta Spotlight" width={640} height={360} className="w-full h-auto" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2 text-gray-900">Loofta Spotlight (Twitter Space)</h3>
                  <p className="text-gray-600 text-sm mb-2">Join our weekly Twitter Space with top KOLs and projects.</p>
                  <div className="text-sm font-semibold text-gray-900">Only $50</div>
                </div>
              </div>
            </div>

            {/* Row: Ambassador + KOL On Demand + Browse KOLs */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
              {/* KOL Packages On Demand (opens info) */}
              <div className="group cursor-pointer" onClick={() => setShowKolInfo(true)}>
                <div className="bg-white h-full rounded-3xl p-6 shadow-md transition-all duration-200 hover:-translate-y-2 hover:shadow-lg">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="bg-gradient-to-br from-[#FF0F00] to-yellow-500 p-3 rounded-xl"></div>
                    <span className="text-sm font-medium text-[#FF0F00] bg-[#FF0F00]/10 px-3 py-1 rounded-full border border-[#FF0F00]/20">On demand</span>
                  </div>
                  <h3 className="font-semibold text-lg mb-2 text-gray-900">KOL Packages</h3>
                  <p className="text-gray-600 text-sm">Tell us your goals; we assemble the right KOLs.</p>
                </div>
              </div>

              {/* Ambassador Program (opens info) */}
              <div className="group cursor-pointer" onClick={() => setShowAmbInfo(true)}>
                <div className="bg-white h-full rounded-3xl p-6 shadow-md transition-all duration-200 hover:-translate-y-2 hover:shadow-lg">
                  <h3 className="font-semibold text-lg mb-2 text-gray-900">Ambassador Program</h3>
                  <p className="text-gray-600 text-sm">Commission‑based referrals. Loofta can manage recruiting and day‑to‑day operations, and find creators for your community.</p>
                </div>
              </div>

              {/* Browse KOLs & Chat */}
              <div className="group cursor-pointer" onClick={() => handleNavigation(CREATORS_ROUTE, 'creators-chat')}>
                <div className="bg-white h-full rounded-3xl p-6 shadow-md transition-all duration-200 hover:-translate-y-2 hover:shadow-lg">
                  <h3 className="font-semibold text-lg mb-2 text-gray-900">Browse KOLs & Chat (Paid)</h3>
                  <p className="text-gray-600 text-sm">Discover and message KOLs directly for paid collaborations.</p>
                </div>
              </div>
            </div>

            {/* Info Modals */}
            {showBoostInfo && (
              <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/60" onClick={() => setShowBoostInfo(false)} />
                <div className="relative z-[71] w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
                  <h4 className="text-lg font-semibold mb-2">How Boost Post works</h4>
                  <p className="text-sm text-gray-700 mb-4">We run a targeted giveaway via Loofta‑verified creators. Entrants must engage (like, comment, bookmark, RT/quote). We select creators and track results.</p>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" className="border-gray-300" onClick={() => setShowBoostInfo(false)}>Close</Button>
                    <Button style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }} onClick={() => { setShowBoostInfo(false); handleNavigation('/boost', 'boost'); }}>Launch Boost</Button>
                  </div>
                </div>
              </div>
            )}

            {showKolInfo && (
              <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/60" onClick={() => setShowKolInfo(false)} />
                <div className="relative z-[71] w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
                  <h4 className="text-lg font-semibold mb-2">KOL Packages (On demand)</h4>
                  <p className="text-sm text-gray-700 mb-4">Tell us your goals and budget. We assemble the right KOLs, manage deliverables, and report results.</p>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" className="border-gray-300" onClick={() => setShowKolInfo(false)}>Close</Button>
                    <Button style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }} onClick={() => window.open('https://t.me/looftaxyz', '_blank')}>Contact on Telegram</Button>
                  </div>
                </div>
              </div>
            )}

            {showAmbInfo && (
              <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/60" onClick={() => setShowAmbInfo(false)} />
                <div className="relative z-[71] w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
                  <h4 className="text-lg font-semibold mb-2">Ambassador Program</h4>
                  <p className="text-sm text-gray-700 mb-4">Commission‑based referrals. Loofta can manage recruiting and day‑to‑day operations, and find creators for your community.</p>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" className="border-gray-300" onClick={() => setShowAmbInfo(false)}>Close</Button>
                    <Button style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }} onClick={() => window.open('https://t.me/looftaxyz', '_blank')}>Contact on Telegram</Button>
                  </div>
                </div>
              </div>
            )}

          </div>

        </div>
      </div>
    </div>
  );

  return (
    <DashboardLayout>
      <DashboardContent />
    </DashboardLayout>
  );
} 