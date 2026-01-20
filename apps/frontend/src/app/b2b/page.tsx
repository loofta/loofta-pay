'use client'

import Link from "next/link";
import { motion } from "framer-motion";
import { Building2, CheckCircle2, Code, Zap, Shield, Globe } from "lucide-react";

export default function B2BCheckoutPage() {
  const features = [
    {
      icon: <Code className="w-6 h-6" />,
      title: "Simple Integration",
      description: "Easy-to-use SDK and API. Get started in minutes with our comprehensive documentation.",
    },
    {
      icon: <Zap className="w-6 h-6" />,
      title: "Fast Setup",
      description: "Branded checkout pages ready to deploy. Customize colors, logos, and messaging to match your brand.",
    },
    {
      icon: <Shield className="w-6 h-6" />,
      title: "Secure & Compliant",
      description: "Non-custodial payments. Your customers' funds never touch our wallets. Built with security best practices.",
    },
    {
      icon: <Globe className="w-6 h-6" />,
      title: "Multi-Chain Support",
      description: "Accept payments from 20+ blockchains. Your customers pay with any token, you receive exactly what you configure.",
    },
  ];

  const benefits = [
    "Accept payments from any blockchain and token",
    "No need to manage multiple wallets or bridges",
    "Lower fees than traditional payment processors",
    "Instant settlement with on-chain confirmation",
    "Private payment options for sensitive transactions",
    "White-label checkout with your branding",
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50">
      {/* Hero Section */}
      <div className="bg-gradient-to-br from-orange-50 via-red-50 to-yellow-50 py-20 md:py-28">
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/80 backdrop-blur-sm border border-orange-200 mb-6">
              <Building2 className="w-5 h-5 text-orange-600" />
              <span className="text-sm font-semibold text-orange-900">Business Integration</span>
            </div>
            <h1 className="text-5xl md:text-6xl font-medium font-sans text-slate-900 leading-tight mb-6">
              Accept <span style={{ backgroundImage: 'linear-gradient(to right, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Multi-Chain Payments</span> in Your App
            </h1>
            <p className="text-xl md:text-2xl text-slate-700 mb-8">
              Integrate Loofta Pay into your platform and let your customers pay with any token from any blockchain.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/b2b/demo"
                className="inline-flex items-center justify-center rounded-full px-8 py-2 text-base font-semibold text-white hover:opacity-90 transition-opacity"
                style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
              >
                Try Demo →
              </Link>
              <a
                href="https://t.me/looftaxyz"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-full px-8 py-2 text-base font-semibold border-2 border-slate-300 bg-white text-slate-900 hover:bg-slate-50 transition-colors"
              >
                Request Integration
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <section className="py-20 md:py-28">
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-medium font-sans text-slate-900 mb-4">
              Why Choose Loofta Pay?
            </h2>
            <p className="text-xl text-slate-600 max-w-2xl mx-auto">
              The most flexible payment solution for Web3 businesses
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {features.map((feature, index) => (
              <div
                key={index}
                className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center"
                    style={{ background: 'linear-gradient(to right, rgba(255,15,0,0.1), rgba(234,179,8,0.1))' }}
                  >
                    <div className="text-orange-600">
                      {feature.icon}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-slate-900 mb-2">{feature.title}</h3>
                    <p className="text-slate-600">{feature.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-20 md:py-28 bg-white">
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-4xl md:text-5xl font-medium font-sans text-slate-900 mb-6">
                Built for <span style={{ backgroundImage: 'linear-gradient(to right, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Modern Businesses</span>
              </h2>
              <p className="text-xl text-slate-600 mb-8">
                Whether you're building a marketplace, SaaS platform, or e-commerce store, Loofta Pay integrates seamlessly into your workflow.
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
              <h3 className="text-2xl font-semibold text-slate-900 mb-4">How It Works</h3>
              <div className="space-y-6">
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-orange-500 text-white flex items-center justify-center font-bold">
                    1
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-900 mb-1">Integrate SDK</h4>
                    <p className="text-slate-600">Add our SDK to your app with a few lines of code.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-orange-500 text-white flex items-center justify-center font-bold">
                    2
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-900 mb-1">Create Payment Links</h4>
                    <p className="text-slate-600">Generate payment requests via API or dashboard.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-orange-500 text-white flex items-center justify-center font-bold">
                    3
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-900 mb-1">Get Paid</h4>
                    <p className="text-slate-600">Receive payments in your preferred token/chain automatically.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section - Same style as homepage */}
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
                  Ready to get started?
                </h2>
                <p className="mt-6 text-lg md:text-xl text-white max-w-xl">
                  Contact us to discuss integration options.<br />
                  <span className="font-semibold">We'll help you integrate multi-chain payments into your platform.</span>
                </p>
                <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
                  <a
                    href="https://t.me/looftaxyz"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full px-8 py-4 text-base font-semibold bg-[#0F172A] text-white hover:opacity-90 transition-colors"
                  >
                    Chat on Telegram
                  </a>
                  <Link
                    href="/claim"
                    className="rounded-full px-8 py-4 text-base font-semibold bg-white text-red-500 hover:bg-gray-50 transition-colors"
                  >
                    Try It Free
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

