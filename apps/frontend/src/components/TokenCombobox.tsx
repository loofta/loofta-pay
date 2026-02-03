'use client'

import * as React from "react";
import Image from "next/image";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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

type Props = {
	tokens: NearToken[];
	value?: TokenSelection;
	onChange: (selection: TokenSelection) => void;
	placeholder?: string;
	className?: string;
	onQuery?: (q: string) => Promise<NearToken[]>;
	hideChains?: string[]; // Chains to hide from selection (e.g., ['solana'])
};

export function TokenCombobox({
	tokens,
	value,
	onChange,
	placeholder = "Select token...",
	className,
	onQuery,
	hideChains = []
}: Props) {
	const [open, setOpen] = React.useState(false);
	const [query, setQuery] = React.useState("");
	// Filter out tokens from hidden chains
	const filteredTokens = React.useMemo(() => {
		if (hideChains.length === 0) return tokens;
		return tokens.filter(t => !hideChains.includes(t.chain?.toLowerCase() || ''));
	}, [tokens, hideChains]);
	const [options, setOptions] = React.useState<NearToken[]>(filteredTokens);
	const [loading, setLoading] = React.useState(false);
	const selectedToken = React.useMemo(() => {
		return findTokenBySelection(tokens, value);
	}, [tokens, value]);
	const [selectedChain, setSelectedChain] = React.useState<string | undefined>(value?.chain);

	// keep options in sync if tokens prop changes and no query
	React.useEffect(() => {
		if (!query) {
			setOptions(filteredTokens);
		}
	}, [filteredTokens, query]);

	React.useEffect(() => {
		// Ensure selectedChain is a valid option only when it's set.
		// Allow undefined to represent "All networks".
		const chains = uniqueChains(options);
		if (selectedChain && !chains.includes(selectedChain)) {
			setSelectedChain(value?.chain && chains.includes(value.chain) ? value.chain : chains[0]);
		}
	}, [options, selectedChain, value]);

	// debounced remote search
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

	// If query clearly matches a single network, auto-select it for convenience
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
		<Dialog open={open} onOpenChange={setOpen}>
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
							<span className="text-xs text-muted-foreground ml-1">
								{formatChainLabel(selectedToken.chain)}
							</span>
						) : null}
					</div>
					<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-[640px] w-[min(96vw,640px)] p-0 overflow-hidden">
				<DialogHeader className="px-4 py-3 border-b">
					<DialogTitle className="text-sm text-muted-foreground">Select token</DialogTitle>
				</DialogHeader>
				<div className="flex">
					{/* Left: Networks */}
					<div className="w-40 max-h-[65vh] overflow-auto border-r border-border/50 p-1">
						<div className="px-3 py-2 text-xs font-medium text-muted-foreground">Select network</div>
						<div className="flex flex-col gap-1 p-1">
							{/* All networks option */}
							<button
								key="__all__"
								type="button"
								onClick={() => setSelectedChain(undefined)}
								className={cn(
									"w-full text-left rounded-xl px-3 py-2 text-sm transition-colors",
									!selectedChain ? "bg-muted font-semibold" : "hover:bg-muted/60"
								)}
							>
								<span className="inline-flex items-center gap-2">
									All networks
								</span>
							</button>
							{filteredChains.map((c) => {
								const active = c === selectedChain;
								return (
									<button
										key={c}
										type="button"
										onClick={() => setSelectedChain(c)}
										className={cn(
											"w-full text-left rounded-xl px-3 py-2 text-sm transition-colors",
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

					{/* Right: Tokens (grouped by symbol) */}
					<div className="flex-1 min-w-0 max-h-[65vh] overflow-hidden">
						<Command>
							<CommandInput placeholder="Search token, network or address" value={query} onValueChange={setQuery} />
							<CommandList className="max-h-[55vh]">
								{loading ? (
									<div className="py-4 text-center text-sm text-muted-foreground">Searching…</div>
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
															<div className="text-xs text-muted-foreground truncate">
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
											// Get available chains for this token
											const availableChains = Object.keys(g.chains);
											// Use selectedChain if set, otherwise use first available chain
											const effectiveChain = selectedChain || availableChains[0];
											const tok = effectiveChain ? g.chains[effectiveChain] : undefined;
											const id = `${g.symbol}-${effectiveChain || "any"}`;
											const isSelected = value?.symbol === g.symbol && value?.chain === effectiveChain;

											// When "All networks" is selected, show available chains count
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
															<div className="text-xs text-muted-foreground truncate">
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
			</DialogContent>
		</Dialog>
	);
}


