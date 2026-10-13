'use client'

import Image from "next/image";

const LOOFTA_HOME = "https://www.loofta.xyz/";

type LooftaPayLogoLinkProps = {
  href?: string;
  imageWidth: number;
  imageHeight: number;
  imageClassName?: string;
};

export function LooftaPayLogoLink({
  href = LOOFTA_HOME,
  imageWidth,
  imageHeight,
  imageClassName,
}: LooftaPayLogoLinkProps) {
  return (
    <a href={href} className="inline-flex items-center hover:opacity-90 transition-opacity">
      <Image
        src="/loofta-white.svg"
        alt="loofta"
        width={imageWidth}
        height={imageHeight}
        className={imageClassName}
      />
    </a>
  );
}
