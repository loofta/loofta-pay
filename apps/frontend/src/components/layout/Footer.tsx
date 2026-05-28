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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 md:gap-12">
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

          {/* For business */}
          <div>
            <h4 className="text-white font-semibold mb-4">{t('forBusiness')}</h4>
            <ul className="space-y-2">
              <li><a href={looftaXyz.checkout} className="text-slate-400 hover:text-white transition-colors">{t('checkout')}</a></li>
              <li><a href={looftaXyz.partners} className="text-slate-400 hover:text-white transition-colors">{t('partners')}</a></li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="text-white font-semibold mb-4">{t('company')}</h4>
            <ul className="space-y-2">
              <li><a href={looftaXyz.about} className="text-slate-400 hover:text-white transition-colors">{t('about')}</a></li>
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
