'use client'

import Image from "next/image";
import Link from "next/link";

const BADGE_ON_DARK =
  "shrink-0 rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400/95";
const BADGE_ON_LIGHT =
  "shrink-0 rounded-full border border-amber-600/35 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800";
const BADGE_MAINNET_ON_DARK =
  "shrink-0 rounded-full border border-green-500/35 bg-green-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-400";
const BADGE_MAINNET_ON_LIGHT =
  "shrink-0 rounded-full border border-green-600/35 bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-700";

type LooftaPayLogoLinkProps = {
  href?: string;
  imageWidth: number;
  imageHeight: number;
  imageClassName?: string;
  badgeVariant: "on-dark" | "on-light";
  /** Controls which network badge to show next to the logo */
  isMainnet?: boolean;
};

export function LooftaPayLogoLink({
  href = "/",
  imageWidth,
  imageHeight,
  imageClassName,
  badgeVariant,
  isMainnet = true,
}: LooftaPayLogoLinkProps) {
  return (
    <Link href={href} prefetch className="inline-flex items-center gap-2 hover:opacity-90 transition-opacity">
      <span className="relative inline-block shrink-0">
        <Image
          src="/loofta.svg"
          alt="Loofta Pay"
          width={imageWidth}
          height={imageHeight}
          className={imageClassName}
        />
        <span
          className="absolute -top-3.5 -right-5 text-sm font-semibold px-1 py-0.5 rounded-full"
          style={{
            background: "linear-gradient(to right, #EAB308, #FF0F00)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          pay
        </span>
      </span>
      {isMainnet ? (
        <span className={badgeVariant === "on-dark" ? BADGE_MAINNET_ON_DARK : BADGE_MAINNET_ON_LIGHT}>Mainnet</span>
      ) : (
        <span className={badgeVariant === "on-dark" ? BADGE_ON_DARK : BADGE_ON_LIGHT}>Devnet</span>
      )}
    </Link>
  );
}
