'use client'

import Image from "next/image";
import { looftaXyz } from "@/lib/looftaXyzUrls";
import { useTranslations } from "next-intl";
import { FooterControls } from "@/components/FooterControls";

export function Footer() {
  const t = useTranslations('Footer');

  return (
    <footer className="bg-[#18181F] pt-32 md:pt-40 pb-12">
      <div className="max-w-7xl mx-auto px-4 md:px-8">
        <div className="grid grid-cols-2 md:grid-cols-7 gap-8 md:gap-8">
          {/* Logo */}
          <div className="col-span-2 md:col-span-1">
            <Image
              src="/loofta_white.svg"
              alt="Loofta"
              width={140}
              height={40}
              className="h-10 w-auto"
            />
          </div>

          {/* For you */}
          <div>
            <h4 className="text-white font-semibold mb-4">{t('forYou')}</h4>
            <ul className="space-y-2">
              <li><a href="/" className="text-slate-400 hover:text-white transition-colors">{t('send')}</a></li>
              <li><a href="/?tab=receive" className="text-slate-400 hover:text-white transition-colors">{t('receive')}</a></li>
              <li><a href="/history" className="text-slate-400 hover:text-white transition-colors">{t('history')}</a></li>
              <li><a href="/settings" className="text-slate-400 hover:text-white transition-colors">{t('settings')}</a></li>
            </ul>
          </div>

          {/* Partners (was "For business" — the app header's own "For Business" link was
              removed, this is now the only nav to /partners) */}
          <div>
            <h4 className="text-white font-semibold mb-4">Partners</h4>
            <ul className="space-y-2">
              <li><a href={looftaXyz.checkout} className="text-slate-400 hover:text-white transition-colors">{t('checkout')}</a></li>
              <li><a href={looftaXyz.partners} className="text-slate-400 hover:text-white transition-colors">{t('partners')}</a></li>
              <li><a href="/payment-links" className="text-slate-400 hover:text-white transition-colors">Payment links</a></li>
              <li><a href="/docs" className="text-slate-400 hover:text-white transition-colors">Developer docs</a></li>
            </ul>
          </div>

          {/* Learn */}
          <div>
            <h4 className="text-white font-semibold mb-4">Learn</h4>
            <ul className="space-y-2">
              <li><a href="/how-it-works" className="text-slate-400 hover:text-white transition-colors">How Loofta works</a></li>
              <li><a href="/guides/send-crypto-privately" className="text-slate-400 hover:text-white transition-colors">Send crypto privately</a></li>
              <li><a href="/usdc-to-ngn" className="text-slate-400 hover:text-white transition-colors">USDC to Naira rate</a></li>
              <li><a href="/dollar-to-naira-today" className="text-slate-400 hover:text-white transition-colors">Dollar to Naira today</a></li>
              <li><a href="/vs/paypal" className="text-slate-400 hover:text-white transition-colors">Loofta vs PayPal</a></li>
              <li><a href="/blog" className="text-slate-400 hover:text-white transition-colors">Blog</a></li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="text-white font-semibold mb-4">{t('company')}</h4>
            <ul className="space-y-2">
              <li><a href={looftaXyz.about} className="text-slate-400 hover:text-white transition-colors">{t('about')}</a></li>
              <li><a href="/careers" className="text-slate-400 hover:text-white transition-colors">Careers</a></li>
              <li><a href="mailto:hello@loofta.xyz" className="text-slate-400 hover:text-white transition-colors">Support</a></li>
              <li><a href="https://t.me/looftapay" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors">Telegram support chat</a></li>
              <li><a href="/terms" className="text-slate-400 hover:text-white transition-colors">Terms of Service</a></li>
              <li><a href="/privacy" className="text-slate-400 hover:text-white transition-colors">Privacy Policy</a></li>
            </ul>
          </div>

          {/* Socials & Docs */}
          <div>
            <h4 className="text-white font-semibold mb-4">{t('socialsAndDocs')}</h4>
            <ul className="space-y-2">
              <li><a href="https://medium.com/@looftaxyz" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors">Medium</a></li>
              <li><a href="https://twitter.com/looftapay" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors">Twitter</a></li>
              <li><a href="https://t.me/looftapay" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors">Telegram</a></li>
              <li><a href="https://loofta.gitbook.io/docs" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors">Docs</a></li>
            </ul>
          </div>

          {/* Ecosystem */}
          <div>
            <h4 className="text-white font-semibold mb-4">Ecosystem</h4>
            <ul className="space-y-2">
              <li><a href="https://magicblock.xyz" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors">MagicBlock</a></li>
              <li><a href="https://blink.cash" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors">Blink.cash</a></li>
            </ul>
          </div>
        </div>

        {/* Language + currency switchers */}
        <FooterControls />

        {/* Copyright */}
        <div className="mt-6">
          <p className="text-slate-500 text-base md:text-sm text-center">
            {t('copyright', { year: new Date().getFullYear() })}
          </p>
        </div>
      </div>
    </footer>
  );
}
