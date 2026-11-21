'use client'

import Image from "next/image";

const LOOFTA_HOME = "https://loofta.com/";

type LooftaPayLogoLinkProps = {
  href?: string;
  imageWidth: number;
  imageHeight: number;
  imageClassName?: string;
  /** The logo file: white for dark pages, the orange one for light pages. */
  src?: string;
};

export function LooftaPayLogoLink({
  href = LOOFTA_HOME,
  imageWidth,
  imageHeight,
  imageClassName,
  src = "/loofta-white.svg",
}: LooftaPayLogoLinkProps) {
  return (
    <a href={href} className="inline-flex items-center hover:opacity-90 transition-opacity">
      <Image
        src={src}
        alt="loofta"
        width={imageWidth}
        height={imageHeight}
        className={imageClassName}
      />
    </a>
  );
}
