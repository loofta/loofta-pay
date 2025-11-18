export function getChainIcon(chain?: string): string | undefined {
	if (!chain) return undefined;
	const key = String(chain).toLowerCase();
	// Only map icons that exist in /public/static/icons/network to avoid broken images.
	const map: Record<string, string> = {
		ethereum: "/static/icons/network/ethereum.svg",
		eth: "/static/icons/network/ethereum.svg",
		base: "/static/icons/network/base.svg",
		arbitrum: "/static/icons/network/arbitrum.svg",
		polygon: "/static/icons/network/polygon.svg",
		near: "/static/icons/network/near.svg",
	};
	return map[key];
}


