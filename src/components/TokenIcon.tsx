import * as React from "react";
import Image from "next/image";
import { cmcLogoForSymbol, resolveTokenLogo } from "@/lib/tokenImages";
import { getChainIcon } from "@/lib/chains";
import type { NearToken } from "@/services/nearIntents";

type Props = {
	token?: Partial<NearToken> | null;
	size?: number; // pixels for main circle
	chain?: string;
};

export function TokenIcon({ token, size = 20, chain }: Props) {
	const src =
		resolveTokenLogo(token || {}) ||
		(token?.symbol ? cmcLogoForSymbol(token.symbol) : undefined) ||
		"/images/eth.png";
	const chainSrc = getChainIcon(chain);
	const dim = size;
	return (
		<div className="relative" style={{ width: dim, height: dim }}>
			{src ? (
				<Image
					src={src}
					alt={String(token?.symbol || chain || "token")}
					width={dim}
					height={dim}
					sizes={`${dim}px`}
					unoptimized={/^https?:\/\//.test(src)}
					className="rounded-full object-cover"
				/>
			) : (
				<div className="rounded-full bg-muted" style={{ width: dim, height: dim }} />
			)}
			{chainSrc ? (
				<span
					className="absolute -bottom-1 -left-1 rounded-full bg-white shadow ring-1 ring-black/10 flex items-center justify-center"
					style={{ width: Math.round(dim * 0.45), height: Math.round(dim * 0.45) }}
				>
					<Image
						src={chainSrc}
						alt={String(chain || "chain")}
						width={Math.round(dim * 0.32)}
						height={Math.round(dim * 0.32)}
						sizes={`${Math.round(dim * 0.32)}px`}
						unoptimized={/^https?:\/\//.test(chainSrc)}
						className="rounded-full object-cover"
					/>
				</span>
			) : null}
		</div>
	);
}


