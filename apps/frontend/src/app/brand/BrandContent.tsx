"use client";

import Image from "next/image";
import Link from "next/link";
import { Download } from "lucide-react";

const BRAND_GRADIENT = "bg-gradient-to-r from-[#FF1301] to-[#EAB308]";

const assets = [
  {
    name: "Loofta White",
    description: "Primary logo — use on dark backgrounds",
    file: "/loofta_white.svg",
    filename: "loofta_white.svg",
    bg: "bg-[#0a0a0c] border-white/10",
  },
  {
    name: "Loofta Orange",
    description: "Primary logo — use on light backgrounds",
    file: "/images/logo/loofta_logo_orange.svg",
    filename: "loofta_logo_orange.svg",
    bg: "bg-white/[0.96] border-white/10",
    dark: false,
  },
  {
    name: "Icon",
    description: "App icon — use on dark backgrounds",
    file: "/images/logo/icon_nobg_loofta.svg",
    filename: "loofta-icon.svg",
    bg: "bg-[#0a0a0c] border-white/10",
    square: true,
  },
  {
    name: "Icon White",
    description: "App icon — use on dark backgrounds",
    file: "/images/logo/loofta-icon-white.svg",
    filename: "loofta-icon-white.svg",
    bg: "bg-[#0a0a0c] border-white/10",
    square: true,
  },
];

function DownloadButton({ href, filename }: { href: string; filename: string }) {
  return (
    <a
      href={href}
      download={filename}
      className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 font-grotesk text-[13px] font-medium text-white transition-all duration-200 hover:-translate-y-0.5 ${BRAND_GRADIENT} shadow-[0_10px_30px_-10px_rgba(255,19,1,0.4)]`}
    >
      <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
      Download SVG
    </a>
  );
}

export default function BrandPage() {
  return (
    <main className="min-h-screen bg-[#0a0a0c] px-10 py-24 text-white antialiased">
      <div className="mx-auto max-w-[960px]">
        {/* header */}
        <div className="mb-16">
          <Link
            href="/"
            className="mb-10 inline-flex font-grotesk text-[13px] text-slate-500 hover:text-white"
          >
            ← Back
          </Link>
          <h1 className="mb-3 font-display text-[clamp(2.4rem,5vw,4rem)] font-medium leading-[1.05] tracking-[-0.03em] text-white">
            Brand assets
          </h1>
          <p className="font-grotesk text-[17px] leading-[1.6] text-slate-400">
            Download Loofta logos for press, integrations, or partnerships.
          </p>
        </div>

        {/* assets grid */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-4">
          {assets.map((a) => (
            <div
              key={a.name}
              className="flex flex-col overflow-hidden rounded-[20px] border border-white/[0.08] bg-white/[0.02]"
            >
              {/* preview */}
              <div
                className={`flex items-center justify-center border-b border-white/[0.06] p-10 ${a.bg} ${a.square ? "aspect-square" : "h-[160px]"}`}
              >
                <Image
                  src={a.file}
                  alt={a.name}
                  width={a.square ? 72 : 160}
                  height={a.square ? 72 : 40}
                  className="object-contain"
                />
              </div>
              {/* info */}
              <div className="flex flex-1 flex-col gap-4 p-6">
                <div>
                  <div className="mb-1 font-display text-[17px] font-medium text-white">{a.name}</div>
                  <div className="font-grotesk text-[13px] text-slate-500">{a.description}</div>
                </div>
                <div className="mt-auto">
                  <DownloadButton href={a.file} filename={a.filename} />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* usage notes */}
        <div className="mt-14 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8">
          <h2 className="mb-5 font-display text-[20px] font-medium text-white">Usage guidelines</h2>
          <ul className="flex flex-col gap-3">
            {[
              "Don't alter colors, proportions, or add effects to the logo.",
              "Maintain clear space around the logo equal to the height of the wordmark.",
              "Use the white version on dark backgrounds, orange version on light.",
              "For questions: hello@loofta.xyz",
            ].map((t) => (
              <li key={t} className="flex items-start gap-3 font-grotesk text-[14px] text-slate-400">
                <span className="mt-[3px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-600" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
