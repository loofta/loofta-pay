'use client'

import Link from "next/link";
import { motion } from "framer-motion";
import { Handshake, CheckCircle2, Globe, Zap, Shield, Users, ShoppingBag, Ticket } from "lucide-react";

const PARTNERS = [
  {
    id: "sp3nd",
    name: "Sp3nd",
    tagline: "Shop Amazon with Stablecoins",
    description: "Paste any Amazon product URL to get started. Pay with USDC or other stablecoins via Loofta Pay.",
    href: "/partners/sp3nd",
    icon: <ShoppingBag className="w-6 h-6" />,
  },
  {
    id: "theinternettoken",
    name: "Internet Lottery",
    tagline: "Official lottery tickets with crypto",
    description: "Buy lottery tickets with any token. Pay from any supported chain; we convert to ETH on Base for your ticket.",
    href: "/checkout/lottery?organizationId=theinternettoken",
    organizationId: "theinternettoken",
    logoUrl: "/partners/internet-lottery-logo.png",
    icon: <Ticket className="w-6 h-6" />,
  },
  {
    id: "partner-2",
    name: "Coming soon",
    tagline: "Next partner",
    description: "More partners and integrations coming soon.",
    href: "#",
    icon: <Zap className="w-6 h-6" />,
  },
  {
    id: "partner-3",
    name: "Coming soon",
    tagline: "Next partner",
    description: "More partners and integrations coming soon.",
    href: "#",
    icon: <Globe className="w-6 h-6" />,
  },
];

export default function PartnersPage() {
  const benefits = [
    "Revenue share and referral programs",
    "Co-marketing and go-to-market support",
    "Technical integration support and documentation",
    "Dedicated partner success contact",
    "Early access to new features and chains",
    "Listing in our partner directory",
  ];

  const partnerTypes = [
    {
      icon: <Zap className="w-6 h-6" />,
      title: "Wallets & dApps",
      description: "Integrate Loofta Pay so your users can pay and get paid across chains without leaving your app.",
    },
    {
      icon: <Globe className="w-6 h-6" />,
      title: "Platforms & Marketplaces",
      description: "Offer multi-chain checkout to your merchants. We handle settlement and compliance.",
    },
    {
      icon: <Users className="w-6 h-6" />,
      title: "Referral Partners",
      description: "Refer businesses and earn when they use Loofta Pay. Simple tracking and payouts.",
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50">
      {/* Hero Section */}
      <div className="bg-gradient-to-br from-orange-50 via-red-50 to-yellow-50 py-20 md:py-28">
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/80 backdrop-blur-sm border border-orange-200 mb-6">
              <Handshake className="w-5 h-5 text-orange-600" />
              <span className="text-sm font-semibold text-orange-900">Partner Program</span>
            </div>
            <h1 className="text-5xl md:text-6xl font-medium font-sans text-slate-900 leading-tight mb-6">
              Grow with <span style={{ backgroundImage: 'linear-gradient(to right, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Loofta Pay</span>
            </h1>
            <p className="text-xl md:text-2xl text-slate-700 mb-8">
              Join our partner network. Integrate multi-chain payments, refer businesses, or build on top of our infrastructure.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href="https://t.me/looftaxyz"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-full px-8 py-2 text-base font-semibold text-white hover:opacity-90 transition-opacity"
                style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
              >
                Become a Partner →
              </a>
              <Link
                href="/b2b"
                className="inline-flex items-center justify-center rounded-full px-8 py-2 text-base font-semibold border-2 border-slate-300 bg-white text-slate-900 hover:bg-slate-50 transition-colors"
              >
                B2B Checkout
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Our Partners */}
      <section className="py-20 md:py-28">
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-medium font-sans text-slate-900 mb-4">
              Our Partners
            </h2>
            <p className="text-xl text-slate-600 max-w-2xl mx-auto">
              Shop, pay, and integrate with our partner ecosystem.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {PARTNERS.map((partner) => (
              <Link
                key={partner.id}
                href={partner.href}
                target={partner.href === "#" ? undefined : "_blank"}
                rel={partner.href === "#" ? undefined : "noopener noreferrer"}
                className={`rounded-2xl border border-gray-200 bg-white p-8 shadow-sm hover:shadow-md transition-all block text-left ${partner.href === "#" ? "pointer-events-none opacity-75" : ""}`}
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden"
                    style={{ background: 'linear-gradient(to right, rgba(255,15,0,0.1), rgba(234,179,8,0.1))' }}
                  >
                    {"logoUrl" in partner && partner.logoUrl ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={partner.logoUrl} alt={partner.name} className="w-full h-full object-contain" onError={(e) => { e.currentTarget.style.display = "none"; const next = e.currentTarget.nextElementSibling as HTMLElement; if (next) { next.style.display = ""; next.classList.remove("hidden"); } }} />
                        <div className="text-orange-600 hidden">{partner.icon}</div>
                      </>
                    ) : (
                      <div className="text-orange-600">{partner.icon}</div>
                    )}
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-slate-900 mb-1">{partner.name}</h3>
                    <p className="text-sm font-medium text-orange-600 mb-2">{partner.tagline}</p>
                    <p className="text-slate-600">{partner.description}</p>
                    {partner.href !== "#" && (
                      <span className="inline-flex items-center gap-1 mt-3 text-orange-600 font-semibold">
                        Get started →
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Partner types */}
      <section className="py-20 md:py-28 bg-white">
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-medium font-sans text-slate-900 mb-4">
              Who We Partner With
            </h2>
            <p className="text-xl text-slate-600 max-w-2xl mx-auto">
              Wallets, platforms, and referral partners—we work with teams that want to offer the best multi-chain payment experience.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {partnerTypes.map((item, index) => (
              <div
                key={index}
                className="rounded-2xl border border-gray-200 bg-gray-50 p-8 shadow-sm"
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center"
                    style={{ background: 'linear-gradient(to right, rgba(255,15,0,0.1), rgba(234,179,8,0.1))' }}
                  >
                    <div className="text-orange-600">
                      {item.icon}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-slate-900 mb-2">{item.title}</h3>
                    <p className="text-slate-600">{item.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-20 md:py-28">
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-4xl md:text-5xl font-medium font-sans text-slate-900 mb-6">
                Partner <span style={{ backgroundImage: 'linear-gradient(to right, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Benefits</span>
              </h2>
              <p className="text-xl text-slate-600 mb-8">
                We invest in long-term partnerships with shared incentives and support so you can grow with us.
              </p>
              <ul className="space-y-4">
                {benefits.map((benefit, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <CheckCircle2 className="w-6 h-6 text-green-500 flex-shrink-0 mt-0.5" />
                    <span className="text-lg text-slate-700">{benefit}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-8">
              <div className="flex items-center gap-3 mb-4">
                <Shield className="w-8 h-8 text-orange-500" />
                <h3 className="text-2xl font-semibold text-slate-900">Why Loofta Pay</h3>
              </div>
              <p className="text-slate-600 mb-4">
                Non-custodial, multi-chain infrastructure that works across 20+ chains. Your users keep custody; you get a seamless payment layer.
              </p>
              <Link
                href="/swap"
                className="inline-flex items-center gap-2 text-orange-600 font-semibold hover:underline"
              >
                Try Swaps →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section id="contact" className="relative z-10 px-4 md:px-8 mb-[-80px]">
        <div className="max-w-5xl rounded-[40px] mx-auto overflow-hidden">
          <motion.div
            className="rounded-[40px] bg-cover bg-opacity-2"
            style={{
              backgroundImage: 'url(/bg_footer.png)',
              backgroundColor: 'rgba(255, 255, 255, 0.5)',
              backgroundBlendMode: 'lighten',
              backgroundPosition: 'center',
              backgroundPositionY: '60%',
            }}
          >
            <div
              className="rounded-[40px]"
              style={{
                backgroundImage: 'linear-gradient(to right, rgba(255,19,1,0.85), rgba(234,179,8,0.85))',
              }}
            >
              <div className="flex flex-col items-center py-12 md:py-18 px-8 md:px-16 text-center">
                <h2 className="text-3xl md:text-6xl font-medium font-sans text-white leading-tight">
                  Ready to partner?
                </h2>
                <p className="mt-6 text-lg md:text-xl text-white max-w-xl">
                  Tell us about your project and how you’d like to work with Loofta Pay.
                </p>
                <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
                  <a
                    href="https://t.me/looftaxyz"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full px-8 py-4 text-base font-semibold bg-[#0F172A] text-white hover:opacity-90 transition-colors"
                  >
                    Get in Touch
                  </a>
                  <Link
                    href="/b2b"
                    className="rounded-full px-8 py-4 text-base font-semibold bg-white text-red-500 hover:bg-gray-50 transition-colors"
                  >
                    B2B Checkout
                  </Link>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
