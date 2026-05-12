'use client'

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import Image from "next/image";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogPortal, DialogTrigger, DialogTitle } from "@/components/ui/dialog";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { NearToken } from "@/services/nearIntents";
import { findTokenBySelection, formatChainLabel, groupTokensBySymbol, uniqueChains } from "@/lib/tokens";
import type { TokenSelection } from "@/app/utils/types";
import { TokenIcon } from "./TokenIcon";
import { getChainIcon } from "@/lib/chains";
import { resolveTokenLogo } from "@/lib/tokenImages";

type Props = {
	tokens: NearToken[];
	value?: TokenSelection;
	onChange: (selection: TokenSelection) => void;
	placeholder?: string;
	className?: string;
	onQuery?: (q: string) => Promise<NearToken[]>;
	hideChains?: string[];
	/** When true, "All networks" is selected by default so all chains are visible (e.g. for withdraw token picker). */
	defaultShowAllChains?: boolean;
};

const EMPTY_CHAINS: string[] = [];

export function TokenCombobox({
	tokens,
	value,
	onChange,
	placeholder = "Select token...",
	className,
	onQuery,
	hideChains = EMPTY_CHAINS,
	defaultShowAllChains = false
}: Props) {
	const [open, setOpen] = React.useState(false);
	const [query, setQuery] = React.useState("");
	const filteredTokens = React.useMemo(() => {
		return tokens.filter(t => {
			if (hideChains.length > 0 && hideChains.includes(t.chain?.toLowerCase() || '')) return false;
			return resolveTokenLogo(t) != null;
		});
	}, [tokens, hideChains]);
	const [options, setOptions] = React.useState<NearToken[]>(filteredTokens);
	const [loading, setLoading] = React.useState(false);
	const selectedToken = React.useMemo(() => {
		return findTokenBySelection(tokens, value);
	}, [tokens, value]);
	const [selectedChain, setSelectedChain] = React.useState<string | undefined>(
		defaultShowAllChains ? undefined : value?.chain
	);

	React.useEffect(() => {
		if (!query) {
			setOptions(filteredTokens);
		}
	}, [filteredTokens, query]);

	React.useEffect(() => {
		const chains = uniqueChains(options);
		if (selectedChain && !chains.includes(selectedChain)) {
			setSelectedChain(value?.chain && chains.includes(value.chain) ? value.chain : chains[0]);
		}
	}, [options, selectedChain, value]);

	React.useEffect(() => {
		if (!onQuery) return;
		let active = true;
		const handle = setTimeout(async () => {
			setLoading(true);
			try {
				const next = await onQuery(query);
				if (active) setOptions(next);
			} finally {
				if (active) setLoading(false);
			}
		}, 250);
		return () => {
			active = false;
			clearTimeout(handle);
		};
	}, [query, onQuery]);

	React.useEffect(() => {
		const q = query.trim().toLowerCase();
		if (!q) return;
		const chans = uniqueChains(options);
		const matches = chans.filter(c => formatChainLabel(c).toLowerCase().includes(q) || c.toLowerCase().includes(q));
		if (matches.length === 1 && matches[0] !== selectedChain) {
			setSelectedChain(matches[0]);
		}
	}, [query, options, selectedChain]);

	const grouped = React.useMemo(() => groupTokensBySymbol(options), [options]);
	const chains = React.useMemo(() => uniqueChains(options), [options]);

	const visibleGroups = React.useMemo(() => {
		if (!selectedChain) return grouped;
		return grouped.filter(g => g.chains[selectedChain!]);
	}, [grouped, selectedChain]);
	const isSearching = React.useMemo(() => query.trim().length > 0, [query]);
	const searchItems = React.useMemo(() => {
		if (!isSearching) return [] as Array<{ symbol: string; name?: string; chain: string; token: NearToken }>
		const q = query.trim().toLowerCase();
		const items: Array<{ symbol: string; name?: string; chain: string; token: NearToken }> = [];
		for (const g of grouped) {
			const symbol = g.symbol || "";
			for (const c of Object.keys(g.chains)) {
				const tok = g.chains[c] as NearToken;
				const match = symbol.toLowerCase().includes(q)
					|| (g.name || "").toLowerCase().includes(q)
					|| c.toLowerCase().includes(q)
					|| formatChainLabel(c).toLowerCase().includes(q);
				if (match) items.push({ symbol, name: g.name, chain: c, token: tok });
			}
		}
		return items;
	}, [isSearching, query, grouped]);
	const filteredSearchItems = React.useMemo(() => {
		if (!isSearching) return [] as Array<{ symbol: string; name?: string; chain: string; token: NearToken }>;
		if (!selectedChain) return searchItems;
		return searchItems.filter((it) => it.chain === selectedChain);
	}, [isSearching, searchItems, selectedChain]);
	const filteredChains = React.useMemo(() => {
		if (!isSearching) return chains;
		const s = new Set<string>();
		for (const it of searchItems) s.add(it.chain);
		const arr = Array.from(s.values());
		return arr.length ? arr.sort((a, b) => a.localeCompare(b)) : chains;
	}, [isSearching, searchItems, chains]);

	return (
		// modal={false} prevents a second scroll-lock from conflicting with the
		// parent BalanceModal Dialog on iOS, which throws an unhandled exception.
		<Dialog open={open} onOpenChange={setOpen} modal={false}>
			<DialogTrigger asChild>
				<Button
					variant="outline"
					role="combobox"
					aria-expanded={open}
					className={cn("w-full justify-between", className)}
				>
					<div className="flex items-center gap-2">
						<TokenIcon token={selectedToken ?? undefined} chain={selectedToken?.chain} size={22} />
						<span className="font-semibold">
							{selectedToken ? selectedToken.symbol : placeholder}
						</span>
						{selectedToken ? (
							<span className="text-sm md:text-xs text-muted-foreground ml-1">
								{formatChainLabel(selectedToken.chain)}
							</span>
						) : null}
					</div>
					<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</DialogTrigger>
			<DialogPortal>
				{/* Manual overlay (Radix skips it when modal=false) */}
				<div
					className="fixed inset-0 z-50 bg-black/80"
					onClick={() => setOpen(false)}
				/>
				<DialogPrimitive.Content
					className={cn(
						"fixed z-50 bg-background shadow-lg outline-none flex flex-col",
						"data-[state=open]:animate-in data-[state=closed]:animate-out",
						"data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
						"data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
						// Mobile: full screen
						"inset-0 h-[100dvh] w-screen rounded-none border-0",
						// Desktop: centered modal
						"sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2",
						"sm:h-auto sm:max-h-[min(600px,85vh)] sm:w-[min(96vw,520px)] sm:max-w-[520px] sm:rounded-lg sm:border",
						"p-0 overflow-hidden"
					)}
				>
					{/* Close button */}
					<DialogPrimitive.Close className="absolute right-4 top-4 z-10 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
						<X className="h-4 w-4" />
						<span className="sr-only">Close</span>
					</DialogPrimitive.Close>

					{/* Header */}
					<div className="px-4 py-3 border-b shrink-0">
						<DialogTitle className="text-base md:text-sm font-medium text-muted-foreground">Select token</DialogTitle>
					</div>

					{/* Body: stacked on mobile, side-by-side on desktop */}
					<div className="flex flex-col sm:flex-row flex-1 min-h-0 overflow-hidden">
						{/* Network selector: horizontal scroll strip on mobile, vertical sidebar on desktop */}
						<div className={cn(
							"shrink-0 border-b sm:border-b-0 sm:border-r border-border/50",
							"flex flex-row sm:flex-col",
							"overflow-x-auto sm:overflow-x-hidden sm:overflow-y-auto",
							"sm:w-40 p-1"
						)}>
							<div className="hidden sm:block px-3 py-2 text-sm md:text-xs font-medium text-muted-foreground">
								Select network
							</div>
							<div className="flex flex-row sm:flex-col gap-1 p-1">
								<button
									key="__all__"
									type="button"
									onClick={() => setSelectedChain(undefined)}
									className={cn(
										"whitespace-nowrap text-left rounded-xl px-3 py-2 text-base md:text-sm transition-colors",
										!selectedChain ? "bg-muted font-semibold" : "hover:bg-muted/60"
									)}
								>
									<span className="inline-flex items-center gap-2">All networks</span>
								</button>
								{filteredChains.map((c) => {
									const active = c === selectedChain;
									return (
										<button
											key={c}
											type="button"
											onClick={() => setSelectedChain(c)}
											className={cn(
												"whitespace-nowrap text-left rounded-xl px-3 py-2 text-base md:text-sm transition-colors",
												active ? "bg-muted font-semibold" : "hover:bg-muted/60"
											)}
										>
											<span className="inline-flex items-center gap-2">
												{(() => {
													const src = getChainIcon(c);
													return src ? (
														<Image
															src={src}
															alt={`${formatChainLabel(c)} icon`}
															width={16}
															height={16}
															sizes="16px"
															unoptimized={/^https?:\/\//.test(src)}
														/>
													) : null;
												})()}
												{formatChainLabel(c)}
											</span>
										</button>
									);
								})}
							</div>
						</div>

						{/* Token list */}
						<div className="flex-1 min-w-0 min-h-0 overflow-hidden">
							<Command className="h-full">
								<CommandInput placeholder="Search token, network or address" value={query} onValueChange={setQuery} />
								<CommandList className="max-h-[calc(100dvh-140px)] sm:max-h-[380px] overflow-y-auto">
									{loading ? (
										<div className="py-4 text-center text-base md:text-sm text-muted-foreground">Searching…</div>
									) : null}
									<CommandEmpty>No token found.</CommandEmpty>
									{isSearching ? (
										<CommandGroup heading="Results">
											{filteredSearchItems.map((it) => {
												const isSelected = value?.symbol === it.symbol && value?.chain === it.chain;
												const id = `${it.symbol}-${it.chain}`;
												return (
													<CommandItem
														key={id}
														value={`${it.symbol} ${it.name || ""} ${it.chain}`}
														onSelect={() => {
															onChange({ symbol: it.symbol, chain: it.chain });
															setOpen(false);
														}}
													>
														<div className="flex items-center gap-3 w-full">
															<TokenIcon token={it.token} chain={it.chain} size={22} />
															<div className="flex-1 overflow-hidden">
																<div className="font-semibold truncate">{it.symbol}</div>
																<div className="text-sm md:text-xs text-muted-foreground truncate">
																	{it.name} · {formatChainLabel(it.chain)}
																</div>
															</div>
															<Check className={cn("h-4 w-4", isSelected ? "opacity-100" : "opacity-0")} />
														</div>
													</CommandItem>
												);
											})}
										</CommandGroup>
									) : (
										<CommandGroup heading="Tokens">
											{visibleGroups.map((g) => {
												const availableChains = Object.keys(g.chains);
												const effectiveChain = selectedChain || availableChains[0];
												const tok = effectiveChain ? g.chains[effectiveChain] : undefined;
												const id = `${g.symbol}-${effectiveChain || "any"}`;
												const isSelected = value?.symbol === g.symbol && value?.chain === effectiveChain;
												const showMultiChain = !selectedChain && availableChains.length > 1;

												return (
													<CommandItem
														key={id}
														value={`${g.symbol} ${g.name} ${effectiveChain}`}
														onSelect={() => {
															if (!effectiveChain || !tok) return;
															onChange({ symbol: g.symbol, chain: effectiveChain });
															setOpen(false);
														}}
													>
														<div className="flex items-center gap-3 w-full">
															<TokenIcon token={tok ?? g} chain={effectiveChain} size={22} />
															<div className="flex-1 overflow-hidden">
																<div className="font-semibold truncate">{g.symbol}</div>
																<div className="text-sm md:text-xs text-muted-foreground truncate">
																	{g.name} · {formatChainLabel(effectiveChain)}
																	{showMultiChain && (
																		<span className="ml-1 text-primary/70">+{availableChains.length - 1} more</span>
																	)}
																</div>
															</div>
															<Check className={cn("h-4 w-4", isSelected ? "opacity-100" : "opacity-0")} />
														</div>
													</CommandItem>
												);
											})}
										</CommandGroup>
									)}
								</CommandList>
							</Command>
						</div>
					</div>
				</DialogPrimitive.Content>
			</DialogPortal>
		</Dialog>
	);
}
