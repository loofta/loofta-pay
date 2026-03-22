'use client'

import Image from "next/image";
import Link from "next/link";
import { clusterBadgeLabel, isNonMainnetCluster } from "@/lib/solanaCluster";

const BADGE_ON_DARK =
  "shrink-0 rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400/95";
const BADGE_ON_LIGHT =
  "shrink-0 rounded-full border border-amber-600/35 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800";

type LooftaPayLogoLinkProps = {
  href?: string;
  imageWidth: number;
  imageHeight: number;
  imageClassName?: string;
  /** Cluster badge (e.g. Devnet) sits after “Loofta Pay” */
  badgeVariant: "on-dark" | "on-light";
};

/**
 * Wordmark: Loofta + gradient “pay”, then optional non-mainnet cluster tag (e.g. Devnet).
 */
export function LooftaPayLogoLink({
  href = "/",
  imageWidth,
  imageHeight,
  imageClassName,
  badgeVariant,
}: LooftaPayLogoLinkProps) {
  const clusterTag = clusterBadgeLabel();
  const showClusterBadge = isNonMainnetCluster() && clusterTag;

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
      {showClusterBadge ? (
        <span className={badgeVariant === "on-dark" ? BADGE_ON_DARK : BADGE_ON_LIGHT}>{clusterTag}</span>
      ) : null}
    </Link>
  );
}
