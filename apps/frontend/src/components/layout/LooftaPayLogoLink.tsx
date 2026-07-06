'use client'

import Image from "next/image";
import Link from "next/link";

type LooftaPayLogoLinkProps = {
  href?: string;
  imageWidth: number;
  imageHeight: number;
  imageClassName?: string;
};

export function LooftaPayLogoLink({
  href = "/",
  imageWidth,
  imageHeight,
  imageClassName,
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
          className="absolute -top-3.5 -right-5 text-base md:text-sm font-semibold px-1 py-0.5 rounded-full"
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
    </Link>
  );
}
