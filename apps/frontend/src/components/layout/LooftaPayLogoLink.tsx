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
    <Link href={href} prefetch className="inline-flex items-center hover:opacity-90 transition-opacity">
      <Image
        src="/loofta-white.svg"
        alt="loofta"
        width={imageWidth}
        height={imageHeight}
        className={imageClassName}
      />
    </Link>
  );
}
